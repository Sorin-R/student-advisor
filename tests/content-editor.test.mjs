import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { mkdtemp, readdir, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import sharp from 'sharp'
import { registerContentRoutes, validateContentKey, validateContentValue } from '../server/content-routes.js'
import { configureSecurity, signToken } from '../server/security.js'

// Synthetic credentials and an in-memory transactional store; no application
// environment file or real database is loaded by these integration tests.
process.env.JWT_ACCESS_SECRET = 'synthetic-content-editor-access-secret-for-tests-only'
const roles = {
  student: { role: 'student', permissions: { manageContent: true } },
  reader: { role: 'moderator', permissions: { viewOnly: true } },
  editor: { role: 'moderator', permissions: { manageContent: true } },
  admin: { role: 'admin', permissions: {} },
}

function contentPool(initial = {}) {
  const rows = new Map(Object.entries(initial).map(([key, value]) => [key, JSON.stringify(value)]))
  const locks = new Map()
  const events = []
  return {
    rows, events,
    async execute(sql, values = []) {
      if (sql.includes('auth_sessions s JOIN users')) {
        const role = roles[values[1]]
        return [role ? [{ ...role, id: values[1], email: 'test@example.invalid', email_verified: true, auth_version: 0, two_factor_enabled: true }] : []]
      }
      if (sql.startsWith('SELECT content_value')) return [rows.has(values[0]) ? [{ contentValue: rows.get(values[0]) }] : []]
      if (sql.startsWith('INSERT INTO site_content')) { events.push('replace'); rows.set(values[0], values[1]); return [{ affectedRows: 1 }] }
      throw new Error(`Unexpected SQL: ${sql}`)
    },
    async getConnection() {
      let key, original, unlock, started = false
      return {
        async beginTransaction() { started = true; events.push('begin') },
        async execute(sql, values) {
          assert.equal(started, true, 'writes must run in a transaction')
          if (sql.startsWith('INSERT INTO site_content')) {
            assert.match(sql, /ON DUPLICATE KEY UPDATE content_key = VALUES\(content_key\)/)
            key = values[0]
            const prior = locks.get(key) || Promise.resolve()
            locks.set(key, new Promise(resolve => { unlock = resolve }))
            await prior
            original = rows.get(key)
            if (!rows.has(key)) rows.set(key, values[1])
            events.push('lock')
            return [{ affectedRows: 1 }]
          }
          assert.ok(unlock, 'the content row must be locked before it is read or changed')
          if (sql.startsWith('SELECT content_value')) {
            assert.match(sql, /FOR UPDATE$/)
            assert.equal(values[0], key)
            return [[{ contentValue: rows.get(key) }]]
          }
          if (sql.startsWith('UPDATE site_content')) {
            assert.equal(values[2], key)
            await new Promise(resolve => setImmediate(resolve))
            rows.set(key, values[0]); events.push('write')
            return [{ affectedRows: 1 }]
          }
          throw new Error(`Unexpected transactional SQL: ${sql}`)
        },
        async commit() { events.push('commit'); started = false; unlock(); unlock = null },
        async rollback() {
          events.push('rollback')
          if (unlock) {
            if (original === undefined) rows.delete(key)
            else rows.set(key, original)
            unlock(); unlock = null
          }
          started = false
        },
        release() { assert.equal(started, false); assert.equal(unlock, null); events.push('release') },
      }
    },
  }
}

async function withEditor(fn, initial = {}) {
  const pool = contentPool(initial), audits = []
  const uploadsDir = await mkdtemp(path.join(os.tmpdir(), 'student-advisor-editor-test-'))
  const app = express()
  app.use(express.json({ limit: '256kb' }))
  configureSecurity({ pool })
  registerContentRoutes(app, { pool, uploadsDir, logAuditAction: async event => { audits.push(event) } })
  app.use((error, _req, res, _next) => res.status(error.status || 500).json({ error: error.message }))
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  async function request(url, { role = 'editor', method = 'PATCH', body, form } = {}) {
    const headers = {}
    if (role) headers.Authorization = `Bearer ${signToken({ sub: role, sid: 'synthetic-session', version: 0, type: 'access' })}`
    if (body !== undefined) headers['Content-Type'] = 'application/json'
    return fetch(base + url, { method, headers, body: form || (body === undefined ? undefined : JSON.stringify(body)), signal: AbortSignal.timeout(5000) })
  }
  try { await fn({ request, pool, audits, uploadsDir }) }
  finally {
    server.closeAllConnections(); await new Promise(resolve => server.close(resolve))
    await rm(uploadsDir, { recursive: true, force: true })
  }
}

test('website editor accepts scoped content keys and rejects traversal or unrelated records', () => {
  for (const key of ['ui.home.en', 'ui.home.media', 'ui.study-in-uk.ro']) assert.equal(validateContentKey(key), true)
  for (const key of ['', '../.env', 'users.admin', 'ui/home/en', `ui.${'a'.repeat(130)}`]) assert.equal(validateContentKey(key), false)
})

test('website editor stores bounded plain string fields only', () => {
  assert.equal(validateContentValue({ 'hero.title': 'Study in the UK', 'hero.copy': 'Clear and useful guidance.' }), true)
  assert.equal(validateContentValue({ title: '' }), true)
  for (const value of [null, [], { title: { html: '<script>' } }, { title: ['bad'] }, { 'bad key': 'value' }, JSON.parse('{"__proto__":"bad"}'), { constructor: 'bad' }, { title: 'x'.repeat(5001) }, { title: 'x'.repeat(33 * 1024) }]) assert.equal(validateContentValue(value), false)
  assert.equal(validateContentValue(Object.fromEntries(Array.from({ length: 1001 }, (_, i) => [`field.${i}`, 'x']))), false)
  assert.equal(validateContentValue(Object.fromEntries(Array.from({ length: 27 }, (_, i) => [`field.${i}`, 'x'.repeat(5000)]))), false)
})

test('only administrators and moderators granted content management may change website content', async () => {
  await withEditor(async ({ request, pool, audits }) => {
    for (const role of [null, 'student', 'reader']) {
      for (const [url, method, body] of [
        ['/api/admin/content/ui.home.en/field', 'PATCH', { field: 'hero.title', value: 'Changed' }],
        ['/api/admin/content/ui.home.en', 'PUT', { value: { title: 'Changed' } }],
        ['/api/admin/content/ui.home.media/image', 'POST', undefined],
      ]) assert.equal((await request(url, { role, method, body })).status, role ? 403 : 401)
    }
    assert.deepEqual(pool.events, [])
    assert.deepEqual(audits, [])
    for (const role of ['admin', 'editor']) {
      const response = await request('/api/admin/content/ui.home.en/field', { role, body: { field: 'hero.title', value: role } })
      assert.equal(response.status, 200)
      assert.equal((await response.json()).value['hero.title'], role)
    }
    assert.equal(audits.length, 2)
  })
})

test('independent field saves merge safely and resetting one field preserves the others', async () => {
  await withEditor(async ({ request, pool, audits }) => {
    const endpoint = '/api/admin/content/ui.future-page.en/field'
    const responses = await Promise.all(Array.from({ length: 6 }, (_, i) => request(endpoint, { body: { field: `section.${i}.title`, value: `Title ${i}` } })))
    for (const response of responses) assert.equal(response.status, 200)
    let saved = JSON.parse(pool.rows.get('ui.future-page.en'))
    assert.equal(Object.keys(saved).length, 6)
    for (let i = 0; i < 6; i++) assert.equal(saved[`section.${i}.title`], `Title ${i}`)
    const reset = await request(endpoint, { body: { field: 'section.0.title', value: null } })
    assert.equal(reset.status, 200)
    const result = await reset.json()
    assert.equal(result.fieldValue, null)
    assert.equal(result.field, 'section.0.title')
    assert.equal(Object.hasOwn(result.value, 'section.0.title'), false)
    assert.equal(Object.keys(result.value).length, 5)
    assert.equal(audits.at(-1).metadata.field, 'section.0.title')
    const empty = await request(endpoint, { body: { field: 'section.1.title', value: '' } })
    assert.equal((await empty.json()).value['section.1.title'], '')
    saved = await (await request('/api/content/ui.future-page.en', { role: null, method: 'GET' })).json()
    assert.equal(saved.value['section.2.title'], 'Title 2')
    assert.equal(saved.value['section.1.title'], '')
    assert.equal(pool.events.filter(event => event === 'begin').length, pool.events.filter(event => event === 'commit').length)
  })
})

test('field endpoint rejects invalid, reserved, structured, missing and oversized values before saving', async () => {
  await withEditor(async ({ request, pool }) => {
    const invalid = [
      { field: '__proto__', value: 'bad' }, { field: 'prototype', value: 'bad' }, { field: 'constructor', value: 'bad' },
      { field: 'bad key', value: 'bad' }, { field: 'title"', value: 'bad' }, { field: 'items[0]', value: 'bad' },
      { field: 'x'.repeat(121), value: 'bad' }, { field: 'title', value: {} }, { field: 'title', value: [] },
      { field: 'title', value: false }, { field: 'title' }, { value: 'bad' }, { field: 'title', value: 'x'.repeat(5001) },
    ]
    for (const body of invalid) assert.equal((await request('/api/admin/content/ui.home.en/field', { body })).status, 400)
    for (const key of ['users.admin', 'ui%2Fhome%2Fen', `ui.${'x'.repeat(121)}`]) {
      assert.equal((await request(`/api/admin/content/${key}/field`, { body: { field: 'title', value: 'bad' } })).status, 400)
    }
    assert.deepEqual(pool.events, [])
    assert.equal(pool.rows.size, 0)
  })
})

test('field saves enforce aggregate byte and field limits without changing previously published content', async () => {
  const full = Object.fromEntries(Array.from({ length: 26 }, (_, i) => [`field.${i}`, 'x'.repeat(5000)]))
  const many = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`field.${i}`, 'x']))
  await withEditor(async ({ request, pool }) => {
    for (const [key, value] of [['ui.full.en', 'x'.repeat(5000)], ['ui.many.en', 'one more']]) {
      const previous = pool.rows.get(key)
      const response = await request(`/api/admin/content/${key}/field`, { body: { field: 'extra', value } })
      assert.equal(response.status, 400)
      assert.equal(pool.rows.get(key), previous)
    }
    const reset = await request('/api/admin/content/ui.many.en/field', { body: { field: 'field.0', value: null } })
    assert.equal(reset.status, 200)
    assert.equal((await request('/api/admin/content/ui.many.en/field', { body: { field: 'extra', value: 'allowed' } })).status, 200)
    assert.equal(pool.events.filter(event => event === 'rollback').length, 2)
  }, { 'ui.full.en': full, 'ui.many.en': many })
})

test('concurrent image replacements preserve independent image fields and return usable public assets', async () => {
  const source = await sharp({ create: { width: 2, height: 2, channels: 3, background: '#dc5331' } }).png().toBuffer()
  await withEditor(async ({ request, pool, uploadsDir }) => {
    const upload = async field => {
      const form = new FormData()
      form.set('field', field)
      form.set('image', new Blob([source], { type: 'image/png' }), 'fixture.png')
      const response = await request('/api/admin/content/ui.future-page.media/image', { method: 'POST', form })
      assert.equal(response.status, 201)
      return response.json()
    }
    const [hero, card] = await Promise.all([upload('hero'), upload('card')])
    const saved = JSON.parse(pool.rows.get('ui.future-page.media'))
    assert.equal(saved.hero, hero.url)
    assert.equal(saved.card, card.url)
    assert.equal((await request(hero.url, { method: 'GET', role: null })).status, 200)
    const replacement = await upload('hero')
    assert.notEqual(replacement.url, hero.url)
    assert.equal(replacement.value.card, card.url)
    assert.equal((await request(hero.url, { method: 'GET', role: null })).status, 404)
    assert.equal((await readdir(path.join(uploadsDir, 'site-content'))).length, 2)
  })
})

test('public content endpoint returns only safe string overrides', async () => {
  const pool = { execute: async () => [[{ contentValue: JSON.stringify({ 'hero.title': 'Edited title', unsafe: { html: '<b>bad</b>' }, constructor: 'bad' }), updatedAt: new Date('2026-10-09T12:00:00Z') }]] }
  const app = express()
  registerContentRoutes(app, { pool, uploadsDir: '/tmp/student-advisor-content-test', logAuditAction: async () => {} })
  const server = app.listen(0, '127.0.0.1'); await once(server, 'listening')
  try {
    const base = `http://127.0.0.1:${server.address().port}`
    const response = await fetch(`${base}/api/content/ui.home.en`)
    assert.equal(response.status, 200)
    assert.deepEqual((await response.json()).value, { 'hero.title': 'Edited title' })
    assert.equal((await fetch(`${base}/api/content/users.admin`)).status, 400)
  } finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
})

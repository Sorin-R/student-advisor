import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, writeFile, readFile, symlink, rm } from 'node:fs/promises'
import path from 'node:path'
import os from 'node:os'
import { REQUIRED_APPLICATION_FIELDS, TERMS_VERSION, validateApplicationData, sanitizeApplicationData } from '../shared/application-schema.js'
import { assertVersion, studentStatus, registerApplicationRoutes, cleanupLegacyApplication, safeLegacyName, cleanSubmissions } from '../server/application-routes.js'

function completeData() {
  return { ...Object.fromEntries(REQUIRED_APPLICATION_FIELDS.map((key) => [key, 'Provided'])),
    email: 'student@example.test', phoneCountry: 'GB', phone: '7700900000', nextOfKinPhone: '+44 7700 900001',
    dob: '2000-01-01', graduationYear: '2025', level: 'Undergraduate', termsAccepted: true }
}

test('schema rejects malicious shapes/unknown fields; legacy response sanitizer returns only safe primitives', () => {
  for (const value of [{ firstName: { nested: 'bad' } }, { firstName: ['bad'] }, { role: 'admin' }, { termsAccepted: 'true' }, { motivation: 'a'.repeat(6001) }]) {
    assert.ok(validateApplicationData(value).errors.length)
  }
  const result = sanitizeApplicationData(JSON.stringify({ firstName: { nested: 'bad' }, lastName: ' Valid ', role: 'admin', termsAccepted: 'true', email: 'e'.repeat(400) }))
  assert.deepEqual(Object.keys(result).sort(), ['email', 'lastName'])
  assert.equal(result.lastName, 'Valid')
  assert.equal(result.email.length, 254)
})

test('submission requires server-validated personal/study fields and boolean terms but not English score or files', () => {
  assert.deepEqual(validateApplicationData(completeData(), { submitted: true }).errors, [])
  assert.ok(validateApplicationData({ ...completeData(), termsAccepted: false }, { submitted: true }).errors.some((value) => /Terms/.test(value)))
  assert.ok(validateApplicationData({ ...completeData(), dob: '2000-02-31' }, { submitted: true }).errors.length)
  assert.ok(validateApplicationData({ ...completeData(), phone: '------' }, { submitted: true }).errors.length)
  assert.ok(validateApplicationData({ firstName: 'Draft' }, { submitted: true }).errors.length)
  assert.deepEqual(validateApplicationData({ firstName: 'Draft' }).errors, [])
})

test('students cannot mint adviser states, downgrade review or modify processed applications', () => {
  for (const status of ['in_review', 'complete', 'offer_received']) assert.throws(() => studentStatus(null, status), { status: 400 })
  assert.equal(studentStatus('submitted', 'draft'), 'submitted')
  assert.equal(studentStatus('in_review', 'draft'), 'in_review')
  assert.throws(() => studentStatus('complete', 'draft'), { status: 409 })
  assert.throws(() => studentStatus('complete', 'submitted'), { status: 409 })
})

test('optimistic versions require a fresh explicit version, including initial creation', () => {
  assert.doesNotThrow(() => assertVersion(null, 0))
  assert.doesNotThrow(() => assertVersion({ version: 2 }, 2))
  assert.throws(() => assertVersion({ version: 2 }, undefined), { status: 428 })
  assert.throws(() => assertVersion({ version: 2 }, '2'), { status: 428 })
  assert.throws(() => assertVersion({ version: 2 }, 1), { status: 409 })
  assert.throws(() => assertVersion({ version: 2 }, 0), { status: 409 })
})

function fixture(initial = null) {
  const routes = new Map(), events = [], stored = new Map()
  let row = initial ? structuredClone(initial) : null
  let previous
  const execute = async (sql, params = []) => {
    events.push({ sql, params })
    if (sql.startsWith('SELECT id FROM users')) return [[{ id: 'student' }]]
    if (sql.startsWith('SELECT a.id')) return [[...(row ? [structuredClone(row)] : [])]]
    if (sql.startsWith('SELECT document_key')) return [[...stored.keys()].map((documentKey) => ({ documentKey }))]
    if (sql.startsWith('SELECT file_name')) {
      const file = stored.get(params[1])
      return [file ? [{ fileName: file[2], mimeType: file[3], content: file[4] }] : []]
    }
    if (sql.startsWith('INSERT INTO applications')) row = { id: params[0], userId: params[1], data: JSON.parse(params[2]), status: params[3], version: 1, termsVersion: params[4], termsAcceptedAt: params[5], requestedDocuments: [], documentSubmissions: {} }
    if (sql.startsWith('UPDATE applications SET data = ?, status')) Object.assign(row, { data: JSON.parse(params[0]), status: params[1], termsVersion: params[2], termsAcceptedAt: params[3], version: row.version + 1 })
    if (sql.startsWith('UPDATE applications SET data = ?, document_submissions')) Object.assign(row, { data: JSON.parse(params[0]), documentSubmissions: JSON.parse(params[1]), version: row.version + 1 })
    if (sql.startsWith('INSERT INTO application_document_files')) stored.set(params[1], params)
    if (sql.startsWith('DELETE FROM applications')) row = null
    return [{ affectedRows: 1 }]
  }
  const connection = { execute, beginTransaction: async () => { previous = structuredClone(row); events.push({ sql: 'BEGIN' }) }, commit: async () => events.push({ sql: 'COMMIT' }), rollback: async () => { row = previous; events.push({ sql: 'ROLLBACK' }) }, release() {} }
  const app = Object.fromEntries(['get', 'put', 'patch', 'delete'].map((method) => [method, (url, ...handlers) => routes.set(`${method} ${url}`, handlers.at(-1))]))
  let validated = 0
  registerApplicationRoutes(app, { pool: { execute, query: execute, getConnection: async () => connection }, authRequired: () => {}, advisorRequired: () => () => {},
    validateDocument: async (file) => { validated++; return { ...file, validationStatus: 'validated', scanStatus: 'not_scanned', pages: 1 } } })
  const call = async (method, url, body, params = {}) => {
    const res = { statusCode: 200, headers: {}, status(value) { this.statusCode = value; return this }, json(value) { this.body = value; return this }, setHeader(key, value) { this.headers[key] = value }, send(value) { this.body = value; return this }, end() { return this } }
    await routes.get(`${method} ${url}`)({ body, params, query: {}, user: { sub: 'student' }, ip: '127.0.0.1' }, res, (error) => { throw error })
    return res
  }
  return { call, events, stored, row: () => row, validated: () => validated }
}

test('real PUT handler records terms with server time and atomically audits; direct complete status is refused', async () => {
  const f = fixture()
  assert.equal((await f.call('put', '/api/application', { data: completeData(), status: 'complete', version: 0 })).statusCode, 400)
  assert.equal(f.events.length, 0)
  assert.equal((await f.call('put', '/api/application', { data: completeData(), status: 'submitted', version: 0, termsVersion: 'old' })).statusCode, 400)
  const before = Date.now()
  const res = await f.call('put', '/api/application', { data: completeData(), status: 'submitted', version: 0, termsVersion: TERMS_VERSION })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.version, 1)
  assert.equal(res.body.termsVersion, TERMS_VERSION)
  assert.ok(new Date(res.body.termsAcceptedAt).getTime() >= before)
  assert.ok(f.events.find((item) => item.sql.includes('FOR UPDATE')))
  const auditIndex = f.events.findIndex((item) => item.sql.startsWith('INSERT INTO audit_logs'))
  assert.ok(auditIndex > 0 && auditIndex < f.events.findIndex((item) => item.sql === 'COMMIT'))
})

test('real PUT handler rejects stale/processed writes and never writes object-valued fields', async () => {
  const f = fixture({ id: 'app', userId: 'student', data: completeData(), status: 'submitted', version: 2 })
  assert.equal((await f.call('put', '/api/application', { data: { firstName: { wrong: true } }, status: 'draft', version: 2 })).statusCode, 400)
  assert.equal((await f.call('put', '/api/application', { data: completeData(), status: 'draft', version: 1 })).statusCode, 409)
  assert.ok(f.events.some((item) => item.sql === 'ROLLBACK'))
  assert.equal(f.row().version, 2)
  const locked = fixture({ id: 'app', data: completeData(), status: 'complete', version: 1 })
  assert.equal((await locked.call('put', '/api/application', { data: completeData(), status: 'draft', version: 1 })).statusCode, 409)
  assert.equal((await locked.call('delete', '/api/application', { version: 1 })).statusCode, 409)
})

test('partial upload replaces only a rejected file and preserves submitted/accepted records; stale uploads do not parse bytes', async () => {
  const accepted = { status: 'accepted', mimeType: 'application/pdf', fileName: 'passport.pdf', submittedAt: '2026-01-01T00:00:00Z' }
  const submitted = { status: 'submitted', mimeType: 'image/png', fileName: 'reference.png' }
  const f = fixture({ id: 'app', data: completeData(), status: 'in_review', version: 5, requestedDocuments: ['passport', 'reference', 'transcript'], documentSubmissions: { passport: accepted, reference: submitted, transcript: { status: 'rejected' } } })
  const file = { fileName: 'transcript.pdf', mimeType: 'application/pdf', content: Buffer.from('synthetic mocked parser input').toString('base64') }
  assert.equal((await f.call('patch', '/api/application/documents', { documents: { transcript: file }, version: 4 })).statusCode, 409)
  assert.equal(f.validated(), 0)
  assert.equal((await f.call('patch', '/api/application/documents', { documents: { passport: file }, version: 5 })).statusCode, 409)
  const res = await f.call('patch', '/api/application/documents', { documents: { transcript: file }, version: 5 })
  assert.equal(res.statusCode, 200)
  assert.equal(res.body.version, 6)
  assert.equal(res.body.documentSubmissions.passport.status, 'accepted')
  assert.equal(res.body.documentSubmissions.reference.status, 'submitted')
  assert.equal(res.body.documentSubmissions.transcript.status, 'submitted')
  assert.equal(res.body.documentSubmissions.transcript.hasFile, true)
  assert.deepEqual([...f.stored.keys()], ['transcript'])
})

test('legacy metadata is defensive and paths cannot leave their application directory', () => {
  assert.equal(safeLegacyName('app', 'app/document.pdf'), 'app/document.pdf')
  for (const value of ['other/document.pdf', '../file', 'app/../secret', '/app/file', 'app\\file', 'app/..', 'app/x/y']) assert.equal(safeLegacyName('app', value), null)
  assert.deepEqual(cleanSubmissions({ passport: { status: {}, mimeType: {}, fileName: {}, submittedAt: { toString: 'bad' } }, unknown: { status: 'accepted' } }, 'app'), { passport: { status: 'pending' } })
})

test('historical stored document downloads pass through validation before being returned', async () => {
  const f = fixture({ id: 'app', data: {}, status: 'in_review', version: 1, requestedDocuments: ['passport'], documentSubmissions: { passport: { status: 'submitted', fileName: 'legacy.pdf', mimeType: 'application/pdf' } } })
  f.stored.set('passport', ['app', 'passport', 'legacy.pdf', 'application/pdf', Buffer.from('synthetic historical blob')])
  const res = await f.call('get', '/api/advisor/applications/:id/documents/:key/file', undefined, { id: 'app', key: 'passport' })
  assert.equal(res.statusCode, 200)
  assert.equal(f.validated(), 1)
  assert.equal(res.headers['Content-Disposition'], 'attachment; filename="legacy.pdf"')
  assert.ok(f.events.some((item) => item.sql.startsWith('INSERT INTO audit_logs')))
})

test('legacy deletion removes only the authorized application directory and refuses symlink escape', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'student-advisor-cleanup-test-'))
  const ownId = '12345678-1234-1234-1234-123456789012', linkId = '87654321-1234-1234-1234-123456789012'
  try {
    await mkdir(path.join(dir, 'uploads')); await mkdir(path.join(dir, 'outside')); await writeFile(path.join(dir, 'outside', 'keep'), 'synthetic')
    await mkdir(path.join(dir, 'uploads', ownId)); await writeFile(path.join(dir, 'uploads', ownId, 'delete'), 'synthetic')
    await symlink(path.join(dir, 'outside'), path.join(dir, 'uploads', linkId))
    await cleanupLegacyApplication(path.join(dir, 'uploads'), linkId)
    assert.equal(await readFile(path.join(dir, 'outside', 'keep'), 'utf8'), 'synthetic')
    await cleanupLegacyApplication(path.join(dir, 'uploads'), ownId)
    await assert.rejects(readFile(path.join(dir, 'uploads', ownId, 'delete')), { code: 'ENOENT' })
  } finally { await rm(dir, { recursive: true, force: true }) }
})

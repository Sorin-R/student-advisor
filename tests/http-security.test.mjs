import test from 'node:test'
import assert from 'node:assert/strict'
import express from 'express'
import { once } from 'node:events'
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { installHttpMiddleware, installBrowserRoutes, errorHandler } from '../server/http.js'
import { createRateLimiter } from '../server/rate-limits.js'
import { loadPrivacyNotice } from '../server/privacy.js'

async function withServer(app, fn) {
  const server = app.listen(0, '127.0.0.1')
  await once(server, 'listening')
  const base = `http://127.0.0.1:${server.address().port}`
  try { await fn((url, options = {}) => fetch(base + url, { ...options, signal: AbortSignal.timeout(5000) })) }
  finally { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)) }
}
function appForTest(env = {}) {
  const app = express()
  installHttpMiddleware(app, { pool: {}, frontendUrl: 'https://student.example', env: { NODE_ENV: 'production', ...env }, consume: async () => ({ hits: 1, retryAfter: 60 }) })
  app.get('/api/example', (req, res) => res.json({ ip: req.ip }))
  app.post('/api/example', (req, res) => res.json({ data: req.body }))
  return app
}

test('security headers restrict scripts, embedding, sensitive caching and capabilities', async () => {
  const app = appForTest(); app.use(errorHandler)
  await withServer(app, async request => {
    const response = await request('/api/example')
    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-security-policy'), /script-src 'self'/)
    assert.match(response.headers.get('content-security-policy'), /object-src 'none'/)
    assert.match(response.headers.get('content-security-policy'), /frame-ancestors 'none'/)
    assert.match(response.headers.get('cache-control'), /no-store/)
    assert.match(response.headers.get('strict-transport-security'), /31536000/)
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
    assert.equal(response.headers.get('x-powered-by'), null)
    assert.match(response.headers.get('permissions-policy'), /camera=\(\)/)
  })
})
test('mutating cookie requests reject foreign and missing browser origins', async () => {
  const app = appForTest(); app.use(errorHandler)
  await withServer(app, async request => {
    for (const headers of [{ Origin: 'https://attacker.invalid' }, {}, { Origin: 'https://student.example', 'Sec-Fetch-Site': 'cross-site' }]) {
      assert.equal((await request('/api/example', { method: 'POST', headers: { ...headers, 'Content-Type': 'application/json' }, body: '{}' })).status, 403)
    }
    assert.equal((await request('/api/example', { method: 'POST', headers: { Origin: 'https://student.example', 'Content-Type': 'application/json' }, body: '{}' })).status, 200)
  })
})
test('bad JSON and excessive ordinary JSON return 400 and 413, not server errors', async () => {
  const app = appForTest(); app.use(errorHandler)
  await withServer(app, async request => {
    const headers = { Origin: 'https://student.example', 'Content-Type': 'application/json' }
    assert.equal((await request('/api/example', { method: 'POST', headers, body: '{' })).status, 400)
    assert.equal((await request('/api/example', { method: 'POST', headers, body: JSON.stringify({ text: 'x'.repeat(70_000) }) })).status, 413)
  })
})
test('browser routes work while unknown APIs and assets remain genuine 404s', async () => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'student-advisor-http-test-'))
  try {
    await writeFile(path.join(directory, 'index.html'), '<html><body>test shell</body></html>')
    await mkdir(path.join(directory, 'assets')); await writeFile(path.join(directory, 'assets/index-abcdef.js'), '/* fixture */')
    const app = appForTest(); installBrowserRoutes(app, directory); app.use(errorHandler)
    await withServer(app, async request => {
      for (const route of ['/', '/admin', '/advisor', '/forgot-password', '/reset-password/example', '/verify-email/example', '/privacy', '/terms', '/blog/example', '/universities/example']) {
        const response = await request(route)
        assert.equal(response.status, 200, route); assert.match(await response.text(), /test shell/)
      }
      for (const route of ['/api/unknown', '/assets/missing.js', '/unknown', '/.env']) assert.equal((await request(route)).status, 404, route)
      assert.match((await request('/assets/index-abcdef.js')).headers.get('cache-control'), /immutable/)
      assert.match((await request('/admin')).headers.get('x-robots-tag'), /noindex/)
      assert.match((await request('/?apply=1')).headers.get('x-robots-tag'), /noindex/)
    })
  } finally { await rm(directory, { recursive: true, force: true }) }
})
test('untrusted forwarding headers cannot choose the client IP', async () => {
  const app = appForTest({ TRUST_PROXY: 'false' }); app.use(errorHandler)
  await withServer(app, async request => assert.equal((await (await request('/api/example', { headers: { 'X-Forwarded-For': '198.51.100.8' } })).json()).ip, '127.0.0.1'))
  assert.throws(() => appForTest({ TRUST_PROXY: 'true' }), /trusted proxy/)
})
test('rate limit sends a retry delay and denies requests over the budget', async () => {
  const app = express(); let hits = 0
  app.use(createRateLimiter({ consume: async () => ({ hits: ++hits, retryAfter: 22 }), name: 'test', limit: 2, windowMs: 30_000 }))
  app.get('/', (_req, res) => res.json({ ok: true }))
  await withServer(app, async request => {
    assert.equal((await request('/')).status, 200); assert.equal((await request('/')).status, 200)
    const denied = await request('/'); assert.equal(denied.status, 429); assert.equal(denied.headers.get('retry-after'), '22')
  })
})
test('privacy template cannot accidentally be published as an approved policy', async () => {
  assert.equal(await loadPrivacyNotice(new URL('../config/privacy.example.json', import.meta.url)), null)
  assert.equal(await loadPrivacyNotice('/nonexistent/privacy.json'), null)
})

test('login throttling cannot block logout or consume the session-maintenance budget', async () => {
  const hits = new Map(), app = express()
  installHttpMiddleware(app, { pool: {}, frontendUrl: 'https://student.example', env: { NODE_ENV: 'test' }, consume: async key => {
    hits.set(key, (hits.get(key) || 0) + 1)
    return { hits: hits.get(key), retryAfter: 60 }
  } })
  app.post('/api/auth/login', (_req, res) => res.status(401).json({ error: 'Synthetic failed login' }))
  app.post('/api/auth/logout', (_req, res) => res.status(204).end())
  app.post('/api/auth/refresh', (_req, res) => res.json({ ok: true }))
  app.use(errorHandler)
  await withServer(app, async request => {
    const options = { method: 'POST', headers: { Origin: 'https://student.example' } }
    for (let i = 0; i < 30; i++) assert.equal((await request('/api/auth/login', options)).status, 401)
    assert.equal((await request('/api/auth/login', options)).status, 429)
    assert.equal((await request('/api/auth/refresh', options)).status, 200)
    assert.equal((await request('/api/auth/logout', options)).status, 204)
    assert.equal([...hits.entries()].find(([key]) => key.startsWith('auth:'))[1], 31)
    assert.equal([...hits.entries()].find(([key]) => key.startsWith('logout:'))[1], 1)
  })
})
test('an exhausted global API cap still permits origin-checked logout with its own cap', async () => {
  const app = express(); let logoutHits = 0
  installHttpMiddleware(app, { pool: {}, frontendUrl: 'https://student.example', env: { NODE_ENV: 'test' }, consume: async key => ({ hits: key.startsWith('api:') ? 241 : key.startsWith('logout:') ? ++logoutHits : 1, retryAfter: 30 }) })
  for (const endpoint of ['/api/auth/logout', '/api/auth/logout-all']) app.post(endpoint, (_req, res) => res.status(204).end())
  app.post('/api/auth/logout-extra', (_req, res) => res.status(204).end())
  app.get('/api/example', (_req, res) => res.json({ ok: true }))
  app.use(errorHandler)
  await withServer(app, async request => {
    const options = { method: 'POST', headers: { Origin: 'https://student.example' } }
    assert.equal((await request('/api/example')).status, 429)
    assert.equal((await request('/api/auth/logout', options)).status, 204)
    assert.equal((await request('/api/auth/logout-all', options)).status, 204)
    assert.equal((await request('/api/auth/logout-extra', options)).status, 429)
    assert.equal((await request('/api/auth/logout', { method: 'POST', headers: { Origin: 'https://attacker.invalid' } })).status, 403)
    logoutHits = 60
    assert.equal((await request('/api/auth/logout', options)).status, 429)
  })
})

import test from 'node:test'
import assert from 'node:assert/strict'
import { selectedDocumentUploads } from '../src/application-client.js'
import { REQUIRED_APPLICATION_FIELDS, validateApplicationData } from '../shared/application-schema.js'

let serial = 0
const response = (data, status = 200) => new Response(status === 204 ? null : JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json' } })
const deferred = () => { let resolve; const promise = new Promise(done => { resolve = done }); return { promise, resolve } }
function storage(values) { const result = { ...values }; Object.defineProperty(result, 'removeItem', { enumerable: false, value(key) { delete this[key] } }); return result }
async function client(t, fetcher, values = {}) {
  const original = { fetch: globalThis.fetch, localStorage: Object.getOwnPropertyDescriptor(globalThis, 'localStorage'), sessionStorage: Object.getOwnPropertyDescriptor(globalThis, 'sessionStorage'), navigator: Object.getOwnPropertyDescriptor(globalThis, 'navigator') }
  Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true })
  globalThis.fetch = fetcher
  Object.defineProperty(globalThis, 'localStorage', { value: storage(values), configurable: true })
  Object.defineProperty(globalThis, 'sessionStorage', { value: storage({}), configurable: true })
  t.after(() => { globalThis.fetch = original.fetch; for (const key of ['localStorage', 'sessionStorage', 'navigator']) { if (!original[key]) delete globalThis[key]; else Object.defineProperty(globalThis, key, original[key]) } })
  return import(`../src/api.js?test=${++serial}`)
}

test('migration removes legacy tokens and application snapshots, retaining language and theme preferences', async t => {
  await client(t, async () => response({}, 401), { student_advisor_access_token: 'synthetic-old-token', student_advisor_applications_test_saved: '["synthetic"]', student_advisor_admin_user: '{}', student_advisor_language: 'ro', student_advisor_theme: 'dark', unrelated: 'keep' })
  assert.deepEqual(Object.keys(globalThis.localStorage).sort(), ['student_advisor_language', 'student_advisor_theme', 'unrelated'])
})

test('concurrent expired requests share one renewal and retry with the in-memory token', async t => {
  let renewals = 0
  const gate = deferred()
  const seen = []
  const c = await client(t, async (url, options) => {
    if (url === '/api/auth/refresh') { renewals++; await gate.promise; return response({ accessToken: 'new-synthetic-token', user: { id: 'test-user' } }) }
    const token = options.headers.get('Authorization'); seen.push(token)
    return token === 'Bearer new-synthetic-token' ? response({ ok: true }) : response({ error: 'Expired' }, 401)
  })
  c.acceptSession({ accessToken: 'old-synthetic-token', user: { id: 'test-user' } })
  const requests = [c.api('/api/application'), c.api('/api/me')]
  await new Promise(resolve => setTimeout(resolve, 10)); gate.resolve()
  assert.deepEqual(await Promise.all(requests), [{ ok: true }, { ok: true }])
  assert.equal(renewals, 1)
  assert.equal(seen.filter(value => value === 'Bearer new-synthetic-token').length, 2)
  assert.equal(Object.keys(globalThis.localStorage).length, 0)
})

test('logout awaits revocation, clears memory and suppresses later silent renewal', async t => {
  const gate = deferred(); let requests = 0
  const c = await client(t, async url => { requests++; assert.equal(url, '/api/auth/logout'); await gate.promise; return response(null, 204) })
  c.acceptSession({ accessToken: 'synthetic', user: { id: 'test-user' } })
  const result = c.logout()
  assert.equal(c.getSession().accessToken, 'synthetic')
  gate.resolve(); await result
  assert.equal(c.getSession().accessToken, '')
  assert.equal(c.getSession().user, null)
  assert.equal(await c.refreshSession(), null)
  assert.equal(requests, 1)
})

test('failed logout does not claim the server session ended and can be retried', async t => {
  let attempts = 0
  const c = await client(t, async () => ++attempts === 1 ? response({ error: 'Unavailable' }, 503) : response(null, 204))
  c.acceptSession({ accessToken: 'synthetic', user: { id: 'test-user' } })
  await assert.rejects(c.logout(), /Unavailable/)
  assert.equal(c.getSession().accessToken, 'synthetic')
  await c.logout()
  assert.equal(c.getSession().user, null)
})

test('a renewal started before logout cannot restore the logged-out session', async t => {
  const gate = deferred()
  const c = await client(t, async url => {
    if (url === '/api/auth/refresh') { await gate.promise; return response({ accessToken: 'late-token', user: { id: 'test-user' } }) }
    return response(null, 204)
  })
  const renewal = c.refreshSession()
  await c.logout(); gate.resolve()
  assert.equal(await renewal, null)
  assert.equal(c.getSession().user, null)
})

test('security proof failures do not automatically replay passwords or one-use recovery codes', async t => {
  let count = 0
  const c = await client(t, async () => { count++; return response({ error: 'Confirm your password.', code: 'REAUTHENTICATION_REQUIRED' }, 401) })
  c.acceptSession({ accessToken: 'synthetic', user: { id: 'test-user' } })
  await assert.rejects(c.api('/api/2fa/disable', { method: 'POST', body: { password: 'synthetic', code: 'synthetic' } }), /Confirm your password/)
  assert.equal(count, 1)
})

test('network failure remains actionable and a failed bootstrap finishes loading state', async t => {
  const c = await client(t, async () => { throw new TypeError('offline') })
  await assert.rejects(c.refreshSession(), /Check your connection/)
  assert.equal(c.getSession().ready, true)
  await assert.rejects(c.api('/api/application'), /Check your connection/)
})

test('partial document replacement uses selected files, keeping submitted and accepted documents untouched', () => {
  const replacement = { name: 'replacement.pdf', size: 100 }
  const submissions = { passport: { status: 'rejected' }, transcript: { status: 'submitted' }, reference: { status: 'accepted' } }
  assert.deepEqual(selectedDocumentUploads({ passport: replacement }, ['passport', 'transcript', 'reference'], submissions), [['passport', replacement]])
  assert.deepEqual(selectedDocumentUploads({ transcript: replacement, reference: replacement, arbitrary: replacement, passport: undefined }, ['passport', 'transcript', 'reference'], submissions), [])
})

test('English score remains optional for an otherwise valid submitted application', () => {
  const data = Object.fromEntries(REQUIRED_APPLICATION_FIELDS.map(key => [key, 'Synthetic value']))
  Object.assign(data, { email: 'synthetic@example.invalid', phoneCountry: 'GB', phone: '7700900000', nextOfKinPhone: '7700900001', dob: '2000-01-01', graduationYear: '2020', level: 'Undergraduate', englishTest: 'Not taken yet', englishScore: '', termsAccepted: true })
  assert.deepEqual(validateApplicationData(data, { submitted: true }).errors, [])
})

test('cookie refresh and logout are serialized through the same browser lock', async t => {
  const gate = deferred(); const order = []
  const c = await client(t, async url => { order.push(url); if (url.endsWith('/refresh')) { await gate.promise; return response({ accessToken: 'renewed', user: { id: 'synthetic' } }) }; return response(null, 204) })
  let queue = Promise.resolve()
  const locks = []
  globalThis.navigator.locks = { request(name, task) { locks.push(name); const result = queue.then(task); queue = result.catch(() => {}); return result } }
  c.acceptSession({ accessToken: 'old', user: { id: 'synthetic' } })
  const refresh = c.refreshSession(), logout = c.logout()
  await new Promise(resolve => setTimeout(resolve, 5))
  assert.deepEqual(order, ['/api/auth/refresh'])
  gate.resolve(); await Promise.all([refresh, logout])
  assert.deepEqual(order, ['/api/auth/refresh', '/api/auth/logout'])
  assert.equal(new Set(locks).size, 1)
  assert.equal(c.getSession().user, null)
})

test('logout broadcasts no credentials and clears another tab memory session', async t => {
  const originalWindow = globalThis.window, originalChannel = globalThis.BroadcastChannel
  const peers = [], sent = []
  globalThis.window = {}
  globalThis.BroadcastChannel = class {
    constructor() { peers.push(this) }
    postMessage(value) { sent.push(value); peers.filter(peer => peer !== this).forEach(peer => peer.onmessage?.({ data: value })) }
  }
  t.after(() => { if (originalWindow === undefined) delete globalThis.window; else globalThis.window = originalWindow; globalThis.BroadcastChannel = originalChannel })
  const first = await client(t, async () => response(null, 204))
  const second = await import(`../src/api.js?test=${++serial}`)
  first.acceptSession({ accessToken: 'first-tab-token', user: { id: 'synthetic' } })
  second.acceptSession({ accessToken: 'second-tab-token', user: { id: 'synthetic' } })
  await first.logout()
  assert.deepEqual(sent, ['signed-out'])
  assert.equal(second.getSession().user, null)
  assert.equal(second.getSession().accessToken, '')
})

test('renewal never resends another account’s form after a different tab changes the account cookie', async t => {
  let applicationRequests = 0
  const c = await client(t, async url => {
    if (url === '/api/auth/refresh') return response({ accessToken: 'other-account-token', user: { id: 'other-account' } })
    applicationRequests++; return response({ error: 'Expired' }, 401)
  })
  c.acceptSession({ accessToken: 'first-account-token', user: { id: 'first-account' } })
  await assert.rejects(c.api('/api/application', { method: 'PUT', body: { data: { firstName: 'Synthetic' }, version: 1, status: 'draft' } }), /account changed/)
  assert.equal(applicationRequests, 1)
  assert.equal(c.getSession().user, null)
})

import test from 'node:test'
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import bcrypt from 'bcryptjs'
import { generate, generateSecret } from 'otplib'
import { AuthError, authRequired, configureSecurity, decrypt, encrypt, hashPassword, hashToken, issueSession, revokeUserSessions, signToken, validatePassword, validateSecurityConfig, verifyPassword, verifyToken } from '../server/security.js'
import { authTransaction, registerAuthRoutes, validateGoogleProfile } from '../server/auth-routes.js'
import { assertAuthSchema, migrateAuth } from '../server/auth-migrations.js'

// Synthetic test configuration only. No dotenv, real database or network is used.
process.env.JWT_ACCESS_SECRET = 'synthetic-access-secret-for-isolated-tests-only'
process.env.JWT_REFRESH_SECRET = 'synthetic-refresh-secret-for-isolated-tests-only'
process.env.TWO_FACTOR_ENCRYPTION_KEY = 'ab'.repeat(32)
process.env.NODE_ENV = 'test'
const user = extra => ({ id: 'test-user', email: 'person@example.invalid', email_verified: true, auth_version: 0, role: 'student', two_factor_enabled: false, totp_last_step: null, ...extra })
function mockPool(handler) {
  const calls = [], connection = { async execute(sql, values = []) { calls.push({ sql, values }); return handler(sql, values) }, async query(sql, values = []) { calls.push({ sql, values }); return handler(sql, values) }, async beginTransaction() { calls.push({ transaction: 'begin' }) }, async commit() { calls.push({ transaction: 'commit' }) }, async rollback() { calls.push({ transaction: 'rollback' }) }, release() { calls.push({ transaction: 'release' }) } }
  return { ...connection, calls, async getConnection() { return connection } }
}
function harness(pool, options = {}) {
  const routes = new Map(), audit = [], mail = []
  const app = { get(path, ...handlers) { routes.set(`GET ${path}`, handlers) }, post(path, ...handlers) { routes.set(`POST ${path}`, handlers) } }
  registerAuthRoutes(app, { pool, frontendUrl: 'https://example.invalid', logAuditAction: async event => { audit.push(event) }, mail: { verification: async value => { mail.push(value) }, reset: async value => { mail.push(value) }, notification: async value => { mail.push(value) } }, qrCode: { toDataURL: async () => 'data:image/png;base64,synthetic' }, ...options })
  return { routes, audit, mail, async invoke(path, req = {}, method = 'POST') {
    const handlers = routes.get(`${method} ${path}`); assert.ok(handlers, path)
    const request = { body: {}, cookies: {}, query: {}, params: {}, ip: '127.0.0.1', ...req, get: name => name.toLowerCase() === 'authorization' ? (req.authorization || '') : '' }
    const response = { statusCode: 200, headers: {}, cookies: {}, cleared: [], set(k, v) { this.headers[k] = v; return this }, status(n) { this.statusCode = n; return this }, json(v) { this.body = v; return this }, cookie(k, v, options) { this.cookies[k] = { value: v, options }; return this }, clearCookie(k) { this.cleared.push(k); return this }, redirect(url) { this.statusCode = 302; this.location = url; return this }, end() { return this } }
    async function dispatch(index) { if (index >= handlers.length) return; let downstream; await handlers[index](request, response, error => { if (error) throw error; downstream = dispatch(index + 1) }); await downstream }
    await dispatch(0); return response
  } }
}

test('configuration validates independent signing keys and AES key length', () => {
  validateSecurityConfig()
  assert.throws(() => validateSecurityConfig({ ...process.env, JWT_ACCESS_SECRET: 'short' }))
  assert.throws(() => validateSecurityConfig({ ...process.env, JWT_REFRESH_SECRET: process.env.JWT_ACCESS_SECRET }))
  assert.throws(() => validateSecurityConfig({ ...process.env, TWO_FACTOR_ENCRYPTION_KEY: 'abc' }))
})
test('scrypt supports long Unicode without bcrypt 72-byte suffix collisions', async () => {
  assert.equal(validatePassword('a'.repeat(14)), false)
  assert.equal(validatePassword('😀'.repeat(15)), true)
  const password = 'a'.repeat(72) + 'a meaningful suffix'
  const hash = await hashPassword(password)
  assert.ok(hash.startsWith('scrypt$'))
  assert.equal(await verifyPassword(password, hash), true)
  assert.equal(await verifyPassword('a'.repeat(72) + 'a different suffix', hash), false)
  assert.equal(await verifyPassword(password, null), false)
})
test('AES-GCM encrypts nondeterministically and rejects modified ciphertext', () => {
  const first = encrypt('synthetic secret'), second = encrypt('synthetic secret')
  assert.notEqual(first, second); assert.equal(decrypt(first), 'synthetic secret')
  assert.throws(() => decrypt(first.slice(0, -2) + (first.endsWith('00') ? '11' : '00')))
})
test('tokens enforce type, expiry, signature and issuer/audience', () => {
  const token = signToken({ sub: 'u', type: 'access' })
  assert.equal(verifyToken(token).sub, 'u')
  assert.throws(() => verifyToken(token, 'access', 'challenge'), AuthError)
  assert.throws(() => verifyToken(token.replace(/.$/, c => c === 'a' ? 'b' : 'a')), AuthError)
  assert.throws(() => verifyToken(signToken({ sub: 'u', type: 'access' }, 'access', -1)), AuthError)
})
test('access tokens stop working immediately after session revocation', async () => {
  let revoked = false
  const pool = mockPool(async sql => { assert.match(sql, /auth_sessions s JOIN users/); return [revoked ? [] : [user({ authenticated_at: new Date() })]] })
  configureSecurity({ pool })
  const token = signToken({ sub: 'test-user', sid: 'session', version: 0, type: 'access' })
  const req = { get: () => `Bearer ${token}` }, res = { status(n) { this.statusCode = n; return this }, json(body) { this.body = body } }
  let calls = 0; await authRequired(req, res, () => { calls++ }); revoked = true
  await authRequired(req, res, () => { calls++ })
  assert.equal(calls, 1); assert.equal(res.statusCode, 401)
})
test('session creation refuses unverified email and unenrolled staff', async () => {
  const connection = mockPool(() => { throw new Error('Should not write') })
  await assert.rejects(issueSession({}, user({ email_verified: false }), { connection }), AuthError)
  await assert.rejects(issueSession({}, user({ role: 'admin' }), { connection }), AuthError)
})
test('revoking user sessions invalidates access versions, sessions, refresh and challenges', async () => {
  const pool = mockPool(async () => [{ affectedRows: 1 }])
  await revokeUserSessions('test-user', pool)
  for (const expected of ['auth_version = auth_version + 1', 'UPDATE auth_sessions', 'UPDATE refresh_tokens', 'UPDATE auth_challenges']) assert.ok(pool.calls.some(call => call.sql?.includes(expected)))
})
test('transactions rollback failures and commit only explicit failed-attempt counters', async () => {
  const pool = mockPool(async () => [[]])
  await assert.rejects(authTransaction(pool, async () => { throw new Error('synthetic') }))
  assert.ok(pool.calls.some(call => call.transaction === 'rollback'))
  const attemptPool = mockPool(async () => [[]]), error = new AuthError(); error.commitAttempts = true
  await assert.rejects(authTransaction(attemptPool, async () => { throw error }))
  assert.ok(attemptPool.calls.some(call => call.transaction === 'commit'))
  assert.ok(!attemptPool.calls.some(call => call.transaction === 'rollback'))
})
test('Google claims require verified email, stable subject and expected nonce', () => {
  const profile = { sub: 'google-id', email: 'person@example.invalid', email_verified: true, nonce: 'nonce' }
  assert.equal(validateGoogleProfile(profile, 'nonce'), profile)
  for (const replacement of [{ sub: '' }, { email_verified: false }, { nonce: 'other' }]) assert.throws(() => validateGoogleProfile({ ...profile, ...replacement }, 'nonce'), AuthError)
})
test('Google start creates state, S256 PKCE and nonce; missing state never reaches provider', async () => {
  let options, exchanges = 0
  const googleClient = { generateAuthUrl(value) { options = value; return 'https://accounts.example.invalid' }, getToken() { exchanges++; throw new Error('Should not run') } }
  const pool = mockPool(async () => [{ affectedRows: 1 }]), h = harness(pool, { googleClient })
  const started = await h.invoke('/api/auth/google/start', {}, 'GET')
  assert.ok(options.state && options.nonce && options.code_challenge)
  assert.equal(options.code_challenge_method, 'S256'); assert.equal(started.cookies.oauth_state.value, options.state)
  const callback = await h.invoke('/api/auth/google/callback', { query: { code: 'synthetic-code' } }, 'GET')
  assert.equal(exchanges, 0); assert.match(callback.location, /auth=failed$/)
})
function googleHarness(existing, emailCollision = false) {
  const nonce = 'synthetic-nonce', proof = { verifier: 'synthetic-pkce', nonce }
  const pool = mockPool(async (sql) => {
    if (sql.includes("kind = 'oauth'")) return [[{ id: 'oauth-challenge', secret_enc: encrypt(JSON.stringify(proof)) }]]
    if (sql.includes('WHERE google_subject')) return [existing ? [existing] : []]
    if (sql.includes('WHERE email')) return [emailCollision ? [{ id: 'password-account' }] : []]
    if (sql.startsWith('INSERT INTO auth_challenges') || sql.startsWith('UPDATE auth_challenges')) return [{ affectedRows: 1 }]
    if (sql.startsWith('INSERT INTO auth_sessions') || sql.startsWith('INSERT INTO refresh_tokens')) throw new Error('Full session must not be created')
    throw new Error(`Unexpected query: ${sql}`)
  })
  const googleClient = { async getToken(value) { assert.equal(value.codeVerifier, proof.verifier); return { tokens: { id_token: 'synthetic-provider-token' } } }, async verifyIdToken() { return { getPayload: () => ({ sub: 'google-owner', email: 'person@example.invalid', email_verified: true, nonce }) } } }
  return harness(pool, { googleClient })
}
test('Google never silently links an existing password account', async () => {
  const h = googleHarness(null, true), response = await h.invoke('/api/auth/google/callback', { query: { code: 'code', state: 'state' }, cookies: { oauth_state: 'state' } }, 'GET')
  assert.match(response.location, /auth=account_exists$/); assert.equal(response.cookies.refresh_token, undefined)
})
test('Google MFA-enabled account gets only a limited challenge, never a full session', async () => {
  const h = googleHarness(user({ role: 'admin', two_factor_enabled: true, google_subject: 'google-owner' }))
  const response = await h.invoke('/api/auth/google/callback', { query: { code: 'code', state: 'state' }, cookies: { oauth_state: 'state' } }, 'GET')
  assert.match(response.location, /auth=pending$/)
  assert.equal(verifyToken(response.cookies.auth_pending.value, 'access', 'challenge').kind, 'login_mfa')
  assert.equal(response.cookies.refresh_token, undefined)
})
test('staff Google login without MFA gets restricted enrollment only', async () => {
  const h = googleHarness(user({ role: 'advisor', google_subject: 'google-owner' }))
  const response = await h.invoke('/api/auth/google/callback', { query: { code: 'code', state: 'state' }, cookies: { oauth_state: 'state' } }, 'GET')
  assert.equal(verifyToken(response.cookies.auth_pending.value, 'access', 'challenge').kind, 'enroll_mfa')
  assert.equal(response.cookies.refresh_token, undefined)
})
test('MFA setup stages a secret and does not replace or disable the active factor', async () => {
  const secret = generateSecret(), code = await generate({ secret }), existing = user({ two_factor_enabled: true, two_factor_secret_enc: encrypt(secret), authenticated_at: new Date() })
  const pool = mockPool(async sql => { if (sql.startsWith('SELECT')) return [[existing]]; return [{ affectedRows: 1 }] })
  const h = harness(pool), access = signToken({ sub: existing.id, sid: 'session', version: 0, type: 'access' })
  const response = await h.invoke('/api/2fa/setup', { authorization: `Bearer ${access}`, body: { code } })
  assert.equal(response.statusCode, 200); assert.ok(response.body.setupToken && response.body.manualKey)
  assert.ok(pool.calls.some(call => call.sql?.startsWith('INSERT INTO auth_challenges')))
  assert.ok(!pool.calls.some(call => /SET two_factor_secret_enc|two_factor_enabled = FALSE/.test(call.sql || '')))
})
test('MFA setup rejects a session without existing factor proof', async () => {
  const existing = user({ two_factor_enabled: true, two_factor_secret_enc: encrypt(generateSecret()), authenticated_at: new Date() })
  const pool = mockPool(async sql => sql.startsWith('SELECT') ? [[existing]] : [{ affectedRows: 1 }]), h = harness(pool)
  const response = await h.invoke('/api/2fa/setup', { authorization: `Bearer ${signToken({ sub: existing.id, sid: 'session', version: 0, type: 'access' })}` })
  assert.equal(response.statusCode, 401)
  assert.ok(!pool.calls.some(call => call.sql?.startsWith('INSERT INTO auth_challenges')))
})
test('Google-only non-MFA account must have a recent provider login for enrollment', async () => {
  const existing = user({ authenticated_at: new Date(Date.now() - 10 * 60000) })
  const pool = mockPool(async sql => sql.startsWith('SELECT') ? [[existing]] : [{ affectedRows: 1 }]), h = harness(pool)
  const response = await h.invoke('/api/2fa/setup', { authorization: `Bearer ${signToken({ sub: existing.id, sid: 'session', version: 0, type: 'access' })}` })
  assert.equal(response.statusCode, 401); assert.equal(response.body.code, 'REAUTHENTICATION_REQUIRED')
})
test('staff cannot disable their mandatory MFA', async () => {
  const pool = mockPool(async () => [[user({ role: 'admin', two_factor_enabled: true, authenticated_at: new Date() })]]), h = harness(pool)
  const response = await h.invoke('/api/2fa/disable', { authorization: `Bearer ${signToken({ sub: 'test-user', sid: 'session', version: 0, type: 'access' })}` })
  assert.equal(response.statusCode, 403); assert.equal(response.body.code, 'MFA_REQUIRED')
})
test('expired refresh returns 401 and clears cookies without a database write', async () => {
  const pool = mockPool(() => { throw new Error('Should not query') }), h = harness(pool)
  const response = await h.invoke('/api/auth/refresh', { cookies: { refresh_token: signToken({ sub: 'test-user', sid: 'sid', jti: 'id', type: 'refresh' }, 'refresh', -1) } })
  assert.equal(response.statusCode, 401); assert.ok(response.cleared.includes('refresh_token'))
})
test('used refresh token revokes its entire session family', async () => {
  const existing = user(), session = { id: 'sid', expires_at: new Date(Date.now() + 60000), authenticated_at: new Date() }
  const pool = mockPool(async sql => { if (sql.includes('SELECT * FROM users')) return [[existing]]; if (sql.includes('SELECT * FROM auth_sessions')) return [[session]]; if (sql.includes('SELECT * FROM refresh_tokens')) return [[{ revoked_at: new Date(), expires_at: session.expires_at }]]; return [{ affectedRows: 1 }] })
  const h = harness(pool), token = signToken({ sub: existing.id, sid: session.id, jti: 'old-token', type: 'refresh' }, 'refresh')
  const response = await h.invoke('/api/auth/refresh', { cookies: { refresh_token: token } })
  assert.equal(response.statusCode, 401)
  assert.ok(pool.calls.some(call => call.sql?.startsWith('UPDATE auth_sessions')))
  assert.ok(pool.calls.some(call => call.sql?.includes('UPDATE refresh_tokens')))
  assert.ok(pool.calls.some(call => call.transaction === 'commit'))
  assert.ok(!pool.calls.some(call => call.sql?.startsWith('INSERT INTO refresh_tokens')))
})
test('legacy bcrypt truncation/weak policy requires a password reset', async () => {
  const password = 'a'.repeat(72) + 'suffix', existing = user({ password_hash: await bcrypt.hash(password, 4) })
  const pool = mockPool(async () => [[existing]]), h = harness(pool)
  const response = await h.invoke('/api/auth/login', { body: { email: existing.email, password } })
  assert.equal(response.statusCode, 403); assert.equal(response.body.code, 'PASSWORD_UPDATE_REQUIRED')
  assert.equal(response.cookies.refresh_token, undefined)
})
test('unknown and existing registration use generic verification response', async () => {
  const pool = mockPool(async sql => sql.startsWith('SELECT') ? [[{ id: 'existing' }]] : [{ affectedRows: 1 }]), h = harness(pool)
  const response = await h.invoke('/api/auth/register', { body: { email: 'person@example.invalid', password: 'a suitably long password' } })
  assert.equal(response.statusCode, 202); assert.equal(response.body.requiresEmailVerification, true)
  assert.equal(response.cookies.refresh_token, undefined); assert.equal(h.mail.length, 0)
})
test('migration is explicit and preserves users as unverified; readiness fails closed', async () => {
  const pool = mockPool(async sql => sql.startsWith('SELECT') ? [[]] : [{ affectedRows: 0 }])
  await migrateAuth(pool)
  assert.ok(pool.calls.some(call => call.sql?.includes('email_verified BOOLEAN NOT NULL DEFAULT FALSE')))
  assert.ok(pool.calls.some(call => call.sql?.includes('WHERE session_id IS NULL')))
  await assert.rejects(assertAuthSchema(pool), /migration is required/)
})

test('GET me exposes only the public user projection', async () => {
  const pool = mockPool(async () => [[user({ password_hash: 'not-public', two_factor_secret_enc: 'not-public', authenticated_at: new Date() })]]), h = harness(pool)
  const response = await h.invoke('/api/me', { authorization: `Bearer ${signToken({ sub: 'test-user', sid: 'session', version: 0, type: 'access' })}` }, 'GET')
  assert.equal(response.statusCode, 200); assert.equal(response.body.user.id, 'test-user')
  assert.equal(response.body.user.password_hash, undefined); assert.equal(response.body.user.two_factor_secret_enc, undefined)
})
test('logout revokes a valid bearer session even with a corrupt refresh cookie', async () => {
  const pool = mockPool(async sql => sql.startsWith('SELECT') ? [[user({ authenticated_at: new Date() })]] : [{ affectedRows: 1 }]), h = harness(pool)
  const response = await h.invoke('/api/auth/logout', { authorization: `Bearer ${signToken({ sub: 'test-user', sid: 'bearer-session', version: 0, type: 'access' })}`, cookies: { refresh_token: 'invalid' } })
  assert.equal(response.statusCode, 204)
  assert.ok(pool.calls.some(call => call.sql?.startsWith('UPDATE auth_sessions') && call.values[0] === 'bearer-session'))
  assert.ok(response.cleared.includes('refresh_token'))
})
test('authenticator code cannot be replayed after its time step was used', async () => {
  const secret = generateSecret(), code = await generate({ secret }), existing = user({ two_factor_enabled: true, two_factor_secret_enc: encrypt(secret), totp_last_step: Math.floor(Date.now() / 30000) })
  const pending = { id: 'pending', user_id: existing.id, payload: null }
  const pool = mockPool(async sql => {
    if (sql.includes('SELECT * FROM users')) return [[existing]]
    if (sql.includes('SELECT * FROM auth_challenges')) return [[pending]]
    if (sql.startsWith('INSERT INTO auth_sessions')) throw new Error('Replayed code must not create a session')
    return [{ affectedRows: 1 }]
  }), h = harness(pool)
  const response = await h.invoke('/api/auth/2fa/verify', { body: { code, challengeToken: signToken({ sub: existing.id, jti: pending.id, kind: 'login_mfa', version: 0, type: 'challenge' }) } })
  assert.equal(response.statusCode, 401)
  assert.ok(pool.calls.some(call => call.sql?.includes('attempts = attempts + 1')))
  assert.ok(pool.calls.some(call => call.sql?.includes('mfa_failures = IF')))
  assert.ok(pool.calls.some(call => call.transaction === 'commit'))
})
test('recovery code succeeds once and its hash is consumed under a transaction', async () => {
  const raw = '0123456789ABCDEF'.repeat(2), existing = user({ two_factor_enabled: true }), consumed = new Set()
  let used = false
  const pool = mockPool(async (sql, values) => {
    if (sql.includes('SELECT * FROM users')) return [[existing]]
    if (sql.includes('SELECT * FROM auth_challenges')) return [consumed.has(values[0]) ? [] : [{ id: values[0], user_id: existing.id, payload: null }]]
    if (sql.includes('SELECT id FROM auth_recovery_codes')) { assert.equal(values[1], hashToken(raw)); return [used ? [] : [{ id: 'recovery-code' }]] }
    if (sql.startsWith('UPDATE auth_recovery_codes')) used = true
    if (sql.startsWith('UPDATE auth_challenges SET consumed_at')) consumed.add(values[0])
    return [{ affectedRows: 1 }]
  }), h = harness(pool)
  const pending = id => signToken({ sub: existing.id, jti: id, kind: 'login_mfa', version: 0, type: 'challenge' })
  const first = await h.invoke('/api/auth/2fa/verify', { body: { challengeToken: pending('first'), code: raw.match(/.{1,4}/g).join('-') } })
  assert.equal(first.statusCode, 200); assert.ok(first.body.accessToken); assert.equal(used, true)
  const second = await h.invoke('/api/auth/2fa/verify', { body: { challengeToken: pending('second'), code: raw } })
  assert.equal(second.statusCode, 401)
  assert.equal(pool.calls.filter(call => call.sql?.startsWith('INSERT INTO auth_sessions')).length, 1)
})
test('replayed MFA challenge is rejected even if the code would otherwise be correct', async () => {
  const pool = mockPool(async sql => sql.includes('SELECT * FROM users') ? [[user({ two_factor_enabled: true })]] : [[]]), h = harness(pool)
  const response = await h.invoke('/api/auth/2fa/verify', { body: { challengeToken: signToken({ sub: 'test-user', jti: 'consumed', kind: 'login_mfa', version: 0, type: 'challenge' }), code: '123456' } })
  assert.equal(response.statusCode, 401)
  assert.ok(!pool.calls.some(call => call.sql?.startsWith('INSERT INTO auth_sessions')))
})
test('registration sends a verification link, stores only its hash and creates no session', async () => {
  let created, storedHash
  const pool = mockPool(async (sql, values) => {
    if (sql.includes('SELECT id FROM users WHERE email')) return [[]]
    if (sql.startsWith('INSERT INTO users')) { created = user({ id: values[0], email: values[1], email_verified: false }); assert.ok(values[2].startsWith('scrypt$')) }
    if (sql.includes('SELECT * FROM users WHERE id')) return [[created]]
    if (sql.startsWith('INSERT INTO auth_challenges')) storedHash = values[3]
    if (sql.startsWith('INSERT INTO auth_sessions')) throw new Error('Unverified user must not get a session')
    return [{ affectedRows: 1 }]
  }), h = harness(pool)
  const response = await h.invoke('/api/auth/register', { body: { email: 'new-person@example.invalid', password: 'a new secure password' } })
  assert.equal(response.statusCode, 202); assert.equal(h.mail.length, 1)
  const raw = h.mail[0].verificationUrl.split('/').at(-1)
  assert.match(raw, /^[a-f0-9]{64}$/); assert.equal(storedHash, hashToken(raw)); assert.notEqual(storedHash, raw)
  assert.equal(response.cookies.refresh_token, undefined)
})

test('logout locks multiple users before sessions, both in deterministic order', async () => {
  const pool = mockPool(async (sql, values) => {
    if (sql.includes('auth_sessions s JOIN users')) return [[user({ id: 'a-user', authenticated_at: new Date() })]]
    if (sql.startsWith('SELECT * FROM users')) return [[user({ id: values[0] })]]
    return [{ affectedRows: 1 }]
  }), h = harness(pool)
  const response = await h.invoke('/api/auth/logout', {
    authorization: `Bearer ${signToken({ sub: 'a-user', sid: 'z-session', version: 0, type: 'access' })}`,
    cookies: { refresh_token: signToken({ sub: 'z-user', sid: 'a-session', jti: 'cookie-token', type: 'refresh' }, 'refresh') },
  })
  assert.equal(response.statusCode, 204)
  const userLocks = pool.calls.filter(call => call.sql?.startsWith('SELECT * FROM users') && call.sql.includes('FOR UPDATE'))
  const sessionUpdates = pool.calls.filter(call => call.sql?.startsWith('UPDATE auth_sessions'))
  assert.deepEqual(userLocks.map(call => call.values[0]), ['a-user', 'z-user'])
  assert.deepEqual(sessionUpdates.map(call => call.values[0]), ['a-session', 'z-session'])
  assert.ok(pool.calls.indexOf(userLocks.at(-1)) < pool.calls.indexOf(sessionUpdates[0]))
})

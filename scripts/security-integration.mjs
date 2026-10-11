// Opt-in integration against an isolated, socket-only MySQL instance. Never uses .env.
import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { writeFile, mkdir, mkdtemp, rm } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import mysql from 'mysql2/promise'
import { generate } from 'otplib'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'

const socketPath = process.env.SECURITY_TEST_SOCKET
if (!socketPath?.startsWith('/tmp/student-advisor-security-test-') || !socketPath.endsWith('.sock')) throw new Error('Set SECURITY_TEST_SOCKET to a disposable student-advisor-security-test-*.sock instance.')
const keep = process.argv.includes('--serve')
const database = `student_advisor_security_test_${crypto.randomBytes(6).toString('hex')}`
Object.assign(process.env, {
  DOTENV_CONFIG_PATH: '/dev/null', NODE_ENV: 'test', MYSQL_SOCKET: socketPath,
  MYSQL_HOST: 'localhost', MYSQL_USER: 'root', MYSQL_PASSWORD: '', MYSQL_DATABASE: database,
  MYSQL_SKIP_CREATE_DATABASE: 'true', MYSQL_SSL: 'false',
  JWT_ACCESS_SECRET: crypto.randomBytes(48).toString('hex'), JWT_REFRESH_SECRET: crypto.randomBytes(48).toString('hex'),
  TWO_FACTOR_ENCRYPTION_KEY: crypto.randomBytes(32).toString('hex'), FRONTEND_URL: 'http://127.0.0.1:4055',
  DOCUMENT_REQUIRE_MALWARE_SCAN: 'false', GOOGLE_CLIENT_ID: 'synthetic-client',
  GOOGLE_CLIENT_SECRET: 'synthetic-provider', GOOGLE_CALLBACK_URL: 'http://127.0.0.1:4055/api/auth/google/callback',
})
const control = await mysql.createConnection({ socketPath, user: 'root', password: '' })
await control.query(`CREATE DATABASE \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
const { pool } = await import('../server/db.js')
const { migrateDatabase } = await import('../server/migrate.js')
const { createApp } = await import('../server/index.js')
const { mysqlCounter } = await import('../server/rate-limits.js')
const { REQUIRED_APPLICATION_FIELDS, TERMS_VERSION } = await import('../shared/application-schema.js')
const evidence = { date: new Date().toISOString(), environment: 'Disposable socket-only MySQL; synthetic accounts; stubbed email and Google; actual HTTP, SQL, password hashing, TOTP, PDF workers', checks: [] }
const check = (label) => { evidence.checks.push({ label, passed: true }); console.log(`PASS ${label}`) }
const mail = { verification: new Map(), reset: new Map() }
let googleParameters, googleProfile, server, uploadsDir
const output = path.resolve('output/security-fixes-2026-10-08/integration-results.json')
const password = 'Synthetic testing passphrase 2026!'
const identities = {}
const cookies = response => response.headers.getSetCookie().filter(value => !/Max-Age=0|Expires=Thu, 01 Jan 1970/.test(value)).map(value => value.split(';')[0]).join('; ')
async function call(route, { method = 'GET', body, token, cookie } = {}, expected = 200) {
  const response = await fetch(`http://127.0.0.1:4055${route}`, { method, redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { Origin: process.env.FRONTEND_URL, ...(body ? { 'Content-Type': 'application/json' } : {}), ...(token ? { Authorization: `Bearer ${token}` } : {}), ...(cookie ? { Cookie: cookie } : {}) }, body: body ? JSON.stringify(body) : undefined })
  const bytes = Buffer.from(await response.arrayBuffer())
  let data = null
  if (response.headers.get('content-type')?.includes('application/json')) data = JSON.parse(bytes.toString())
  assert.equal(response.status, expected, `${method} ${route}: ${response.status}; ${data?.error || ''}`)
  return { response, data, bytes, cookie: cookies(response) }
}
async function uploadImage(route, { token, field, bytes, type = 'image/png' }, expected = 201) {
  const form = new FormData()
  form.append('field', field)
  form.append('image', new Blob([bytes], { type }), 'synthetic-image.png')
  const response = await fetch(`http://127.0.0.1:4055${route}`, {
    method: 'POST', redirect: 'manual', signal: AbortSignal.timeout(30000),
    headers: { Origin: process.env.FRONTEND_URL, Authorization: `Bearer ${token}` }, body: form,
  })
  const data = await response.json()
  assert.equal(response.status, expected, `POST ${route}: ${response.status}; ${data?.error || ''}`)
  return { response, data }
}
const auth = (person) => ({ token: person.token })
const post = (route, body, person, expected = 200) => call(route, { method: 'POST', body, ...auth(person || {}) }, expected)
async function register(name, role = 'student') {
  const email = `${name}@example.test`
  await post('/api/auth/register', { email, password, firstName: name, lastName: 'Synthetic' }, null, 202)
  const proof = mail.verification.get(email)?.split('/').at(-1)
  assert.ok(proof)
  const before = await post('/api/auth/login', { email, password }, null, 202)
  assert.equal(before.data.requiresEmailVerification, true)
  await post('/api/auth/verify-email', { token: proof })
  await post('/api/auth/verify-email', { token: proof }, null, 400)
  const [[row]] = await pool.execute('SELECT id FROM users WHERE email = ?', [email])
  if (role !== 'student') await pool.execute('UPDATE users SET role = ? WHERE id = ?', [role, row.id])
  const person = { email, id: row.id, role }
  const login = await post('/api/auth/login', { email, password }, null, role === 'student' ? 200 : 202)
  if (role === 'student') Object.assign(person, { token: login.data.accessToken, cookie: login.cookie })
  else {
    assert.equal(login.data.requiresMfaEnrollment, true)
    assert.equal(login.data.accessToken, undefined)
    await call('/api/admin/users', { token: login.data.enrollmentToken }, 401)
    const setup = await post('/api/2fa/setup', { enrollmentToken: login.data.enrollmentToken })
    assert.match(setup.data.qrCodeDataUrl, /^data:image\/png;base64,/)
    const enrolled = await post('/api/2fa/enable', { setupToken: setup.data.setupToken, code: await generate({ secret: setup.data.manualKey }) })
    Object.assign(person, { token: enrolled.data.accessToken, cookie: enrolled.cookie, recovery: enrolled.data.recoveryCodes, secret: setup.data.manualKey })
    assert.equal(person.recovery.length, 8)
    await post('/api/2fa/disable', { password, code: person.recovery[0] }, person, 403)
  }
  identities[name] = person
  return person
}
try {
  await migrateDatabase(pool)
  await migrateDatabase(pool)
  check('fresh and repeated schema migrations succeed on real MySQL')
  const consume = mysqlCounter(pool)
  const counts = await Promise.all(Array.from({ length: 8 }, () => consume('integration-shared-bucket', 60000)))
  assert.equal(Math.max(...counts.map(item => item.hits)), 8)
  assert.equal((await mysqlCounter(pool)('integration-shared-bucket', 60000)).hits, 9)
  check('MySQL rate limits survive independent counter instances and simultaneous increments')
  uploadsDir = await mkdtemp(path.join(os.tmpdir(), 'student-advisor-integration-uploads-'))
  const app = await createApp({ dbPool: pool, env: { ...process.env, UPLOADS_DIR: uploadsDir }, serveClient: true,
    httpOptions: { consume: async () => ({ hits: 1, retryAfter: 60 }) },
    authOptions: { mail: { verification: async value => mail.verification.set(value.email, value.verificationUrl), reset: async value => mail.reset.set(value.email, value.resetUrl), notification: async () => {} },
      googleClient: { generateAuthUrl: parameters => { googleParameters = parameters; return `https://accounts.google.com/o/oauth2/v2/auth?${new URLSearchParams(parameters)}` }, getToken: async value => { assert.ok(value.codeVerifier); return { tokens: { id_token: 'synthetic-only' } } }, verifyIdToken: async () => ({ getPayload: () => ({ ...googleProfile, nonce: googleParameters.nonce, email_verified: true }) }) } } })
  server = await new Promise(resolve => { const listening = app.listen(4055, '127.0.0.1', () => resolve(listening)) })
  for (const route of ['/api/me', '/api/application', '/api/admin/users', '/api/advisor/applications']) await call(route, {}, 401)
  await call('/api/auth/refresh', { method: 'POST', cookie: 'refresh_token=invalid' }, 401)
  const student = await register('student')
  const other = await register('other')
  const admin = await register('admin', 'admin')
  const adviser = await register('adviser', 'advisor')
  check('verified registration, one-use links, cookie login and mandatory staff MFA enrollment work end to end')
  const me = await call('/api/me', auth(student))
  assert.equal(me.data.user.id, student.id)
  assert.equal(me.data.user.password_hash, undefined)
  assert.equal(me.data.user.two_factor_secret_enc, undefined)
  await call('/api/admin/users', auth(student), 403)
  await call('/api/advisor/applications', auth(student), 403)
  await call('/api/admin/users', auth(adviser), 403)
  check('anonymous/student/adviser/admin authorization and safe user response')

  assert.deepEqual((await call('/api/content/ui.home.en')).data.value, {})
  await call('/api/admin/content/ui.home.en', { method: 'PUT', body: { value: { 'hero.title': 'Edited in the integration test' } }, ...auth(student) }, 403)
  const edited = await call('/api/admin/content/ui.home.en', { method: 'PUT', body: { value: { 'hero.title': 'Edited in the integration test' } }, ...auth(admin) })
  assert.equal(edited.data.value['hero.title'], 'Edited in the integration test')
  assert.equal((await call('/api/content/ui.home.en')).data.value['hero.title'], 'Edited in the integration test')
  const syntheticImage = await sharp({ create: { width: 32, height: 24, channels: 3, background: '#14423f' } }).png().toBuffer()
  await uploadImage('/api/admin/content/ui.home.media/image', { token: student.token, field: 'hero.large', bytes: syntheticImage }, 403)
  const uploadedImage = await uploadImage('/api/admin/content/ui.home.media/image', { token: admin.token, field: 'hero.large', bytes: syntheticImage })
  assert.match(uploadedImage.data.url, /^\/content-images\/[0-9]+-[a-f0-9-]+\.webp$/)
  const publicImage = await call(uploadedImage.data.url)
  assert.equal(publicImage.response.headers.get('content-type'), 'image/webp')
  assert.equal(publicImage.response.headers.get('x-content-type-options'), 'nosniff')
  assert.ok(publicImage.bytes.length > 0)
  check('website editor enforces manageContent, persists public text and converts bounded image uploads to WebP')

  const data = { ...Object.fromEntries(REQUIRED_APPLICATION_FIELDS.map(key => [key, 'Provided'])), firstName: 'Integration', lastName: 'Student', email: student.email, phoneCountry: 'GB', phone: '7700900000', nextOfKinPhone: '+44 7700 900001', dob: '2000-01-01', graduationYear: '2025', level: 'Undergraduate', termsAccepted: true }
  const save = (body, expected = 200) => call('/api/application', { method: 'PUT', body, ...auth(student) }, expected)
  await save({ data, status: 'complete', version: 0 }, 400)
  await save({ data: { firstName: { bad: true } }, status: 'draft', version: 0 }, 400)
  await save({ data, status: 'submitted', version: 0, termsVersion: 'old' }, 400)
  let application = (await save({ data, status: 'submitted', version: 0, termsVersion: TERMS_VERSION })).data
  assert.equal(application.version, 1)
  assert.equal(application.termsVersion, TERMS_VERSION)
  assert.ok(application.termsAcceptedAt)
  assert.equal((await call('/api/application', auth(other))).data.id, null)
  const outcomes = await Promise.all([0, 1].map(async index => {
    const response = await fetch('http://127.0.0.1:4055/api/application', { method: 'PUT', headers: { Origin: process.env.FRONTEND_URL, Authorization: `Bearer ${student.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ data: { ...data, motivation: `Concurrent ${index}` }, version: 1, status: 'draft' }) })
    await response.arrayBuffer(); return response.status
  }))
  assert.deepEqual(outcomes.sort(), [200, 409])
  application = (await call('/api/application', auth(student))).data
  assert.equal(application.status, 'submitted')
  check('application schema, ownership, terms and real concurrent version conflict protection')
  const patch = (route, body, expected = 200) => call(route, { method: 'PATCH', body, ...auth(adviser) }, expected)
  const detail = `/api/advisor/applications/${application.id}`
  application = (await patch(`${detail}/status`, { status: 'in_review', version: application.version })).data
  application = (await patch(`${detail}/documents`, { documents: ['passport', 'transcript'], version: application.version })).data
  const pdf = await PDFDocument.create(); pdf.addPage([300, 300])
  const file = { fileName: 'synthetic.pdf', mimeType: 'application/pdf', content: Buffer.from(await pdf.save()).toString('base64') }
  const upload = (documents, expected = 200) => call('/api/application/documents', { method: 'PATCH', body: { documents, version: application.version }, ...auth(student) }, expected)
  await upload({ passport: { ...file, content: Buffer.from('<html>not a PDF</html>').toString('base64') } }, 422)
  application = (await upload({ passport: file })).data
  application = (await patch(`${detail}/documents/passport`, { status: 'accepted', version: application.version })).data
  application = (await upload({ transcript: { ...file, fileName: 'transcript.pdf' } })).data
  assert.equal(application.documentSubmissions.passport.status, 'accepted')
  assert.equal(application.documentSubmissions.transcript.status, 'submitted')
  await upload({ passport: file }, 409)
  const download = await call(`${detail}/documents/passport/file`, auth(adviser))
  assert.match(download.bytes.toString('ascii', 0, 8), /^%PDF-/)
  assert.match(download.response.headers.get('content-disposition'), /^attachment/)
  assert.equal(download.response.headers.get('cache-control'), 'no-store, private')
  const merged = await call(`${detail}/pdf`, auth(adviser))
  assert.ok((await PDFDocument.load(merged.bytes)).getPageCount() >= 3)
  check('real document worker rejects MIME spoofing, preserves partial uploads, validates downloads and exports combined PDF')
  const summary = (await call('/api/advisor/applications?limit=1', auth(adviser))).data
  assert.equal(summary.applications.length, 1)
  assert.equal(summary.applications[0].data.motivation, undefined)
  assert.equal(summary.applications[0].documentSubmissions, undefined)
  application = (await patch(`${detail}/status`, { status: 'complete', version: application.version })).data
  await save({ data, status: 'draft', version: application.version }, 409)
  await call('/api/application', { method: 'DELETE', body: { version: application.version }, ...auth(student) }, 409)
  check('paginated minimal adviser summaries and processed-record locks')

  await post('/api/support-messages', { name: 'Unverified visitor', email: student.email, topic: 'General', message: 'A synthetic integration message.' }, null, 201)
  const [[support]] = await pool.query('SELECT user_id FROM support_messages ORDER BY created_at DESC LIMIT 1')
  assert.equal(support.user_id, null)
  const users = (await call('/api/admin/users?roleGroup=students&limit=1', auth(admin))).data
  assert.equal(users.users.length, 1); assert.equal(users.hasMore, true)
  const logs = await call('/api/admin/logs?limit=1', auth(admin))
  await call(`/api/admin/logs/${logs.data.logs[0].id}`, { method: 'DELETE', ...auth(admin) }, 405)
  check('unverified support email cannot claim ownership; admin pagination and retained audit history')

  await pool.execute('UPDATE users SET google_subject = ? WHERE id = ?', ['synthetic-staff-google', adviser.id])
  googleProfile = { sub: 'synthetic-staff-google', email: adviser.email }
  const googleStart = await call('/api/auth/google/start', {}, 302)
  assert.ok(googleParameters.state && googleParameters.nonce && googleParameters.code_challenge)
  const googleCallback = await call(`/api/auth/google/callback?code=synthetic&state=${googleParameters.state}`, { cookie: googleStart.cookie }, 302)
  assert.match(googleCallback.response.headers.get('location'), /auth=pending/)
  assert.ok(!googleCallback.cookie.includes('refresh_token='))
  const pending = (await call('/api/auth/pending', { cookie: googleCallback.cookie })).data
  assert.equal(pending.requiresTwoFactor, true)
  const mfaLogin = await post('/api/auth/2fa/verify', { challengeToken: pending.challengeToken, code: adviser.recovery[0] })
  assert.ok(mfaLogin.data.accessToken)
  await post('/api/auth/2fa/verify', { challengeToken: pending.challengeToken, code: adviser.recovery[0] }, null, 401)
  googleProfile = { sub: 'different-google-account', email: student.email }
  const collisionStart = await call('/api/auth/google/start', {}, 302)
  const collision = await call(`/api/auth/google/callback?code=synthetic&state=${googleParameters.state}`, { cookie: collisionStart.cookie }, 302)
  assert.match(collision.response.headers.get('location'), /auth=account_exists/)
  check('Google state/PKCE/nonce integration, staff MFA gate, one-use recovery/challenge and silent-link refusal (provider stub)')

  const badSetup = await post('/api/2fa/setup', { password: 'invalid' }, student, 401)
  assert.equal(badSetup.data.code, 'REAUTHENTICATION_REQUIRED')
  const newSetup = await post('/api/2fa/setup', { password }, student)
  const enabled = await post('/api/2fa/enable', { setupToken: newSetup.data.setupToken, code: await generate({ secret: newSetup.data.manualKey }) }, student)
  await call('/api/me', auth(student), 401)
  student.token = enabled.data.accessToken; student.cookie = enabled.cookie; student.recovery = enabled.data.recoveryCodes
  await post('/api/2fa/setup', { password, code: student.recovery[0] }, student)
  assert.equal((await call('/api/auth/security', auth(student))).data.twoFactorEnabled, true)
  check('MFA requires proof, revokes prior sessions and staging replacement preserves active protection')
  const loginOther = await post('/api/auth/login', { email: other.email, password })
  const oldCookie = loginOther.cookie
  const refreshResults = await Promise.all([0, 1].map(async () => {
    const response = await fetch('http://127.0.0.1:4055/api/auth/refresh', { method: 'POST', headers: { Origin: process.env.FRONTEND_URL, Cookie: oldCookie } })
    return { status: response.status, data: await response.json() }
  }))
  assert.deepEqual(refreshResults.map(item => item.status).sort(), [200, 401])
  await call('/api/me', { token: refreshResults.find(item => item.status === 200).data.accessToken }, 401)
  const fresh = await post('/api/auth/login', { email: other.email, password })
  await post('/api/auth/logout', {}, { token: fresh.data.accessToken }, 204)
  await call('/api/me', { token: fresh.data.accessToken }, 401)
  await call('/api/auth/refresh', { method: 'POST', cookie: fresh.cookie }, 401)
  check('simultaneous refresh reuse revokes whole family; bearer-only logout revokes access and refresh')
  const beforeReset = await post('/api/auth/login', { email: other.email, password })
  await post('/api/auth/forgot-password', { email: other.email })
  const reset = mail.reset.get(other.email).split('/').at(-1)
  await post(`/api/auth/reset-password/${reset}`, { password: 'Another synthetic passphrase 2026!' })
  await call('/api/me', { token: beforeReset.data.accessToken }, 401)
  await post(`/api/auth/reset-password/${reset}`, { password }, null, 400)
  check('password recovery verifies possession, is single-use and invalidates existing access')
  await call(`/api/admin/users/${other.id}/role`, { method: 'PATCH', body: { role: 'moderator', permissions: { viewOnly: true } }, ...auth(admin) })
  await call('/api/me', auth(other), 401)
  check('role changes invalidate existing sessions')
  for (const route of ['/admin', '/advisor', '/forgot-password', '/reset-password/synthetic', '/terms', '/privacy', '/blog', '/study-in-uk']) {
    const page = await call(route); assert.match(page.response.headers.get('content-type'), /text\/html/)
    assert.match(page.response.headers.get('content-security-policy'), /object-src 'none'/)
  }
  await call('/api/no-such-endpoint', {}, 404)
  await call('/api/privacy', {}, 503)
  check('direct SPA routes load with restrictive CSP; unknown API stays 404 and unapproved privacy stays unavailable')
  // Synthetic non-MFA student for browser smoke; no real service or mailbox involved.
  await register('browser')
  evidence.passed = true
} catch (error) {
  evidence.passed = false
  evidence.failure = { message: error.message, code: error.code || error.name, stack: error.stack?.split('\n').slice(0, 5).join('\n') }
  console.error(evidence.failure)
  process.exitCode = 1
} finally {
  await mkdir(path.dirname(output), { recursive: true }); await writeFile(output, `${JSON.stringify(evidence, null, 2)}\n`)
  if (!keep || !evidence.passed) {
    if (server) await new Promise(resolve => server.close(resolve))
    await pool.end(); await control.query(`DROP DATABASE \`${database}\``); await control.end()
    if (uploadsDir) await rm(uploadsDir, { recursive: true, force: true })
  } else {
    console.log('Synthetic browser smoke server ready at http://127.0.0.1:4055 (isolated DB; no external email).')
    const shutdown = async () => { await new Promise(resolve => server.close(resolve)); await pool.end(); await control.query(`DROP DATABASE \`${database}\``); await control.end(); if (uploadsDir) await rm(uploadsDir, { recursive: true, force: true }); process.exit() }
    process.once('SIGINT', shutdown); process.once('SIGTERM', shutdown)
  }
}

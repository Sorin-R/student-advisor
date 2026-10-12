import crypto from 'node:crypto'
import { generateSecret, generateURI, verify } from 'otplib'
import { AuthError, PASSWORD_MESSAGE, authenticateRequest, authRequired, clearAuthCookies, configureSecurity, cookieOptions, decrypt, encrypt, hashPassword, hashToken, issueSession, publicUser, revokeUserSessions, signToken, validatePassword, verifyPassword, verifyRefresh, verifyToken } from './security.js'
import { sendPasswordResetEmail, sendSecurityNotification, sendVerificationEmail } from './email.js'

const EMAIL_MESSAGE = 'If this address can be used, an email with the next step has been sent. Check your inbox.'
const RESET_MESSAGE = 'If an account exists for that email, a password reset link has been sent.'
const LOGIN_MESSAGE = 'Email or password is incorrect. If you have tried repeatedly, wait 15 minutes before trying again.'
const staffRoles = new Set(['admin', 'advisor', 'moderator'])
const json = value => typeof value === 'string' ? JSON.parse(value) : (value || {})
const emailValue = value => typeof value === 'string' ? value.trim().toLowerCase() : ''
const validEmail = value => value.length <= 255 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)
const nameValue = value => typeof value === 'string' ? value.trim().slice(0, 100) : ''
const normalizeRecovery = code => String(code || '').replace(/[-\s]/g, '').toUpperCase()
export async function authTransaction(pool, work) {
  const connection = await pool.getConnection()
  try { await connection.beginTransaction(); const result = await work(connection); await connection.commit(); return result }
  catch (error) { if (error.commitAttempts) await connection.commit(); else await connection.rollback(); throw error }
  finally { connection.release() }
}
export function validateGoogleProfile(profile, expectedNonce) {
  if (!profile || typeof profile.sub !== 'string' || !profile.sub || profile.email_verified !== true || !validEmail(emailValue(profile.email)) || profile.nonce !== expectedNonce) throw new AuthError('Google sign-in could not be verified')
  return profile
}
// Inject providers/database for offline tests. This module does not start a server,
// load environment files, migrate a database or send email during import.
export function registerAuthRoutes(app, { pool, frontendUrl = process.env.FRONTEND_URL, logAuditAction = async () => {}, mail = {}, googleClient, qrCode } = {}) {
  if (!pool) throw new Error('An authentication database pool is required')
  const baseUrl = new URL(frontendUrl || 'http://localhost:5173').origin
  configureSecurity({ pool })
  const email = { verification: sendVerificationEmail, reset: sendPasswordResetEmail, notification: sendSecurityNotification, ...mail }
  let google
  const getGoogle = async () => {
    if (googleClient) return googleClient
    if (!process.env.GOOGLE_CLIENT_ID || !process.env.GOOGLE_CLIENT_SECRET || !process.env.GOOGLE_CALLBACK_URL) throw new AuthError('Google sign-in is unavailable. Use email and password.', 503, 'GOOGLE_UNAVAILABLE')
    if (!google) { const { OAuth2Client } = await import('google-auth-library'); google = new OAuth2Client(process.env.GOOGLE_CLIENT_ID, process.env.GOOGLE_CLIENT_SECRET, process.env.GOOGLE_CALLBACK_URL) }
    return google
  }
  const audit = async (req, action, userId = null) => {
    try { await logAuditAction({ userId, actionType: action, description: action.replaceAll('_', ' '), metadata: null, ipAddress: req.ip }) }
    catch { console.error('Security audit event could not be recorded') }
  }
  const notify = async (req, user, event) => {
    try { await email.notification({ email: user.email, event }) } catch { await audit(req, 'security_notification_delivery_failed', user.id) }
  }
  const route = handler => async (req, res, next) => {
    res.set('Cache-Control', 'no-store')
    try { await handler(req, res) } catch (error) {
      if (error instanceof AuthError) { await audit(req, 'authentication_rejected', req.user?.sub); return res.status(error.status).json({ error: error.message, code: error.code }) }
      next(error)
    }
  }
  const userById = async (connection, id, lock = false) => { const [rows] = await connection.execute(`SELECT * FROM users WHERE id = ? LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [id]); return rows[0] }
  const challenge = async (connection, user, kind, { lifetime = 300, payload = null, secret = null, rawToken = null } = {}) => {
    const id = crypto.randomUUID()
    await connection.execute('INSERT INTO auth_challenges (id, user_id, kind, token_hash, payload, secret_enc, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, user?.id || null, kind, rawToken ? hashToken(rawToken) : null, payload ? JSON.stringify(payload) : null, secret ? encrypt(secret) : null, new Date(Date.now() + lifetime * 1000)])
    return signToken({ sub: user?.id || 'oauth', jti: id, kind, type: 'challenge', version: Number(user?.auth_version || 0) }, 'access', lifetime)
  }
  const getChallenge = async (connection, token, kind, lock = true) => {
    const claims = verifyToken(token, 'access', 'challenge')
    if (claims.kind !== kind || typeof claims.jti !== 'string') throw new AuthError('Invalid or expired verification request')
    if (lock) await userById(connection, claims.sub, true)
    const [rows] = await connection.execute(`SELECT * FROM auth_challenges WHERE id = ? AND kind = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP() AND attempts < 5 LIMIT 1${lock ? ' FOR UPDATE' : ''}`, [claims.jti, kind])
    const value = rows[0]
    if (!value || value.user_id !== claims.sub) throw new AuthError('Invalid or expired verification request')
    value.claims = claims; value.payload = json(value.payload)
    return value
  }
  const consume = (connection, id) => connection.execute('UPDATE auth_challenges SET consumed_at = UTC_TIMESTAMP() WHERE id = ?', [id])
  const attempt = connection => async (value, message = 'Invalid verification code') => {
    await connection.execute('UPDATE auth_challenges SET attempts = attempts + 1 WHERE id = ?', [value.id])
    const error = new AuthError(message); error.commitAttempts = true; throw error
  }
  const issueEmailVerification = async (req, user) => {
    const token = crypto.randomBytes(32).toString('hex')
    await authTransaction(pool, async connection => {
      await userById(connection, user.id, true)
      await connection.execute("UPDATE auth_challenges SET consumed_at = UTC_TIMESTAMP() WHERE user_id = ? AND kind = 'email_verify' AND consumed_at IS NULL", [user.id])
      await challenge(connection, user, 'email_verify', { rawToken: token, lifetime: 1800 })
    })
    try { await email.verification({ email: user.email, verificationUrl: `${baseUrl}/verify-email/${token}` }) } catch { await audit(req, 'verification_email_delivery_failed', user.id) }
  }
  const loginOutcome = async (connection, user, res) => {
    if (['advisor', 'moderator'].includes(user.role) && publicUser(user).permissions?.staffBlocked === true)
      throw new AuthError('This staff account is temporarily blocked. Contact an administrator.', 403, 'ACCOUNT_BLOCKED')
    if (!user.email_verified) return { status: 202, body: { requiresEmailVerification: true, email: user.email, message: 'Verify your email before signing in. You can request another verification email below.' } }
    if (user.two_factor_enabled) return { status: 202, body: { requiresTwoFactor: true, challengeToken: await challenge(connection, user, 'login_mfa') } }
    if (staffRoles.has(user.role)) return { status: 202, body: { requiresMfaEnrollment: true, enrollmentToken: await challenge(connection, user, 'enroll_mfa', { lifetime: 600 }) } }
    return { status: 200, body: { user: publicUser(user), accessToken: await issueSession(res, user, { connection }) } }
  }
  const recordMfaFailure = (connection, userId) => connection.execute('UPDATE users SET mfa_failures = IF(mfa_locked_until IS NOT NULL AND mfa_locked_until <= UTC_TIMESTAMP(), 1, mfa_failures + 1), mfa_locked_until = IF(mfa_failures >= 10, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), NULL) WHERE id = ?', [userId])
  const confirmFactor = async (connection, user, code) => {
    if (user.mfa_locked_until && new Date(user.mfa_locked_until).getTime() > Date.now()) return false
    const recovery = normalizeRecovery(code)
    if (/^[0-9A-F]{32}$/.test(recovery)) {
      const [rows] = await connection.execute('SELECT id FROM auth_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1 FOR UPDATE', [user.id, hashToken(recovery)])
      if (!rows[0]) return false
      await connection.execute('UPDATE auth_recovery_codes SET used_at = UTC_TIMESTAMP() WHERE id = ?', [rows[0].id]); await connection.execute('UPDATE users SET mfa_failures = 0, mfa_locked_until = NULL WHERE id = ?', [user.id]); return true
    }
    if (!/^\d{6}$/.test(String(code || '')) || !user.two_factor_secret_enc) return false
    const result = await verify({ token: code, secret: decrypt(user.two_factor_secret_enc), epochTolerance: 30 })
    if (!result.valid || (user.totp_last_step !== null && user.totp_last_step !== undefined && Number(result.timeStep) <= Number(user.totp_last_step))) return false
    await connection.execute('UPDATE users SET totp_last_step = ?, mfa_failures = 0, mfa_locked_until = NULL WHERE id = ?', [result.timeStep, user.id]); return true
  }
  const recordFailure = (connection, userId) => connection.execute('UPDATE users SET login_failures = IF(login_locked_until IS NOT NULL AND login_locked_until <= UTC_TIMESTAMP(), 1, login_failures + 1), login_locked_until = IF(login_failures >= 10, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), NULL) WHERE id = ?', [userId])
  const securityProof = async (connection, req, user) => {
    const fail = async message => { await recordFailure(connection, user.id); const error = new AuthError(message, 401, 'REAUTHENTICATION_REQUIRED'); error.commitAttempts = true; throw error }
    if (user.login_locked_until && new Date(user.login_locked_until).getTime() > Date.now()) return fail('Too many verification attempts. Wait 15 minutes before trying again.')
    if (user.password_hash && !(await verifyPassword(req.body?.password, user.password_hash))) return fail('Confirm your current password to continue.')
    if (user.two_factor_enabled) {
      if (!(await confirmFactor(connection, user, req.body?.code))) { await recordMfaFailure(connection, user.id); return fail('Enter a new authenticator code or an unused recovery code.') }
    } else if (!user.password_hash && (Date.now() - new Date(req.user.authenticatedAt).getTime() > 5 * 60 * 1000)) {
      throw new AuthError('Sign in with Google again before changing account security.', 401, 'REAUTHENTICATION_REQUIRED')
    }
    await connection.execute('UPDATE users SET login_failures = 0, login_locked_until = NULL WHERE id = ?', [user.id])
  }
  const requireCurrentSession = async (connection, req, user) => {
    if (!req.user || req.user.sub !== user.id || Number(req.user.version) !== Number(user.auth_version)) throw new AuthError('Your session has ended. Sign in again.')
    const [sessions] = await connection.execute('SELECT id FROM auth_sessions WHERE id = ? AND user_id = ? AND revoked_at IS NULL AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE', [req.user.sid, user.id])
    if (!sessions[0]) throw new AuthError('Your session has ended. Sign in again.')
  }
  const recoveryCodes = async (connection, userId) => {
    await connection.execute('DELETE FROM auth_recovery_codes WHERE user_id = ?', [userId])
    const codes = []
    for (let i = 0; i < 8; i++) {
      const raw = crypto.randomBytes(16).toString('hex').toUpperCase()
      await connection.execute('INSERT INTO auth_recovery_codes (id, user_id, code_hash) VALUES (?, ?, ?)', [crypto.randomUUID(), userId, hashToken(raw)])
      codes.push(raw.match(/.{1,4}/g).join('-'))
    }
    return codes
  }

  app.post('/api/auth/register', route(async (req, res) => {
    const address = emailValue(req.body?.email), password = req.body?.password
    if (!validEmail(address) || !validatePassword(password)) throw new AuthError(`Enter a valid email. ${PASSWORD_MESSAGE}`, 400, 'INVALID_REGISTRATION')
    const passwordHash = await hashPassword(password)
    let user
    try {
      user = await authTransaction(pool, async connection => {
        const [existing] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE', [address])
        if (existing[0]) return null
        const value = { id: crypto.randomUUID(), email: address, auth_version: 0 }
        await connection.execute('INSERT INTO users (id, email, password_hash, first_name, last_name, email_verified) VALUES (?, ?, ?, ?, ?, FALSE)', [value.id, address, passwordHash, nameValue(req.body?.firstName), nameValue(req.body?.lastName)])
        return value
      })
    } catch (error) { if (error.code !== 'ER_DUP_ENTRY') throw error }
    if (user) { await issueEmailVerification(req, user); await audit(req, 'account_registered', user.id) }
    res.status(202).json({ requiresEmailVerification: true, email: address, message: EMAIL_MESSAGE })
  }))
  const resendVerification = route(async (req, res) => {
    const address = emailValue(req.body?.email)
    if (validEmail(address)) {
      const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? AND email_verified = FALSE LIMIT 1', [address])
      if (rows[0]) await issueEmailVerification(req, rows[0])
    }
    res.json({ message: EMAIL_MESSAGE })
  })
  app.post('/api/auth/resend-verification', resendVerification)
  app.post('/api/auth/verification/resend', resendVerification)
  app.post('/api/auth/verify-email', route(async (req, res) => {
    const token = req.body?.token
    if (typeof token !== 'string' || !/^[a-f0-9]{64}$/.test(token)) throw new AuthError('This verification link is invalid or expired.', 400)
    const userId = await authTransaction(pool, async connection => {
      const [hints] = await connection.execute("SELECT user_id FROM auth_challenges WHERE token_hash = ? AND kind = 'email_verify' LIMIT 1", [hashToken(token)])
      if (!hints[0]) throw new AuthError('This verification link is invalid or expired.', 400)
      await userById(connection, hints[0].user_id, true)
      const [rows] = await connection.execute("SELECT * FROM auth_challenges WHERE token_hash = ? AND kind = 'email_verify' AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE", [hashToken(token)])
      if (!rows[0]) throw new AuthError('This verification link is invalid or expired.', 400)
      const verification = rows[0]
      const payload = json(verification.payload)
      if (payload.pendingEmail) {
        const address = emailValue(payload.pendingEmail)
        const user = await userById(connection, verification.user_id, true)
        if (!user || emailValue(user.pending_email) !== address) throw new AuthError('This verification link is invalid or expired.', 400)
        await connection.execute('UPDATE users SET email = ?, pending_email = NULL, email_verified = TRUE WHERE id = ?', [address, user.id])
      } else {
        await connection.execute('UPDATE users SET email_verified = TRUE WHERE id = ?', [verification.user_id])
      }
      await consume(connection, rows[0].id); await revokeUserSessions(rows[0].user_id, connection)
      return rows[0].user_id
    })
    await audit(req, 'email_verified', userId)
    res.json({ message: 'Email verified. You can now sign in.' })
  }))
  app.post('/api/auth/login', route(async (req, res) => {
    const address = emailValue(req.body?.email), password = req.body?.password
    const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [validEmail(address) ? address : ''])
    const candidate = rows[0], matched = await verifyPassword(password, candidate?.password_hash)
    if (!candidate || !matched || (candidate.login_locked_until && new Date(candidate.login_locked_until).getTime() > Date.now())) {
      if (candidate) await recordFailure(pool, candidate.id)
      await audit(req, 'login_failed', candidate?.id); throw new AuthError(LOGIN_MESSAGE)
    }
    if (candidate.password_hash.startsWith('$2') && (!validatePassword(password) || Buffer.byteLength(password) > 72)) throw new AuthError('For security, reset your password using Forgot password before signing in.', 403, 'PASSWORD_UPDATE_REQUIRED')
    const outcome = await authTransaction(pool, async connection => {
      const user = await userById(connection, candidate.id, true)
      if (user.password_hash !== candidate.password_hash || Number(user.auth_version) !== Number(candidate.auth_version)) throw new AuthError(LOGIN_MESSAGE)
      await connection.execute('UPDATE users SET login_failures = 0, login_locked_until = NULL WHERE id = ?', [user.id])
      if (user.password_hash.startsWith('$2') && validatePassword(password) && Buffer.byteLength(password) <= 72) await connection.execute('UPDATE users SET password_hash = ? WHERE id = ?', [await hashPassword(password), user.id])
      return loginOutcome(connection, user, res)
    })
    await audit(req, outcome.status === 200 ? 'login_success' : 'login_verification_required', candidate.id)
    res.status(outcome.status).json(outcome.body)
  }))
  app.post('/api/auth/forgot-password', route(async (req, res) => {
    const address = emailValue(req.body?.email)
    if (validEmail(address)) {
      const [rows] = await pool.execute('SELECT * FROM users WHERE email = ? LIMIT 1', [address])
      if (rows[0]) {
        const token = crypto.randomBytes(32).toString('hex'), user = rows[0]
        await authTransaction(pool, async connection => {
          await userById(connection, user.id, true)
          await connection.execute('UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL', [user.id])
          await connection.execute('INSERT INTO password_reset_tokens (id, user_id, token_hash, expires_at, requested_ip) VALUES (?, ?, ?, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), ?)', [crypto.randomUUID(), user.id, hashToken(token), String(req.ip || '').slice(0, 64)])
        })
        try { await email.reset({ email: user.email, resetUrl: `${baseUrl}/reset-password/${token}` }) } catch { await audit(req, 'password_reset_email_delivery_failed', user.id) }
        await audit(req, 'password_reset_requested', user.id)
      }
    }
    res.json({ message: RESET_MESSAGE })
  }))
  app.post('/api/auth/reset-password/:token', route(async (req, res) => {
    if (!validatePassword(req.body?.password)) throw new AuthError(PASSWORD_MESSAGE, 400, 'INVALID_PASSWORD')
    if (!/^[a-f0-9]{64}$/.test(req.params.token)) throw new AuthError('This reset link is invalid or expired.', 400)
    const passwordHash = await hashPassword(req.body.password)
    const user = await authTransaction(pool, async connection => {
      const [hints] = await connection.execute('SELECT user_id FROM password_reset_tokens WHERE token_hash = ? LIMIT 1', [hashToken(req.params.token)])
      if (!hints[0]) throw new AuthError('This reset link is invalid or expired.', 400)
      await userById(connection, hints[0].user_id, true)
      const [rows] = await connection.execute('SELECT * FROM password_reset_tokens WHERE token_hash = ? AND used_at IS NULL AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE', [hashToken(req.params.token)])
      if (!rows[0]) throw new AuthError('This reset link is invalid or expired.', 400)
      const value = await userById(connection, rows[0].user_id, true)
      await connection.execute('UPDATE users SET password_hash = ?, email_verified = TRUE, login_failures = 0, login_locked_until = NULL WHERE id = ?', [passwordHash, value.id])
      await connection.execute('UPDATE password_reset_tokens SET used_at = UTC_TIMESTAMP() WHERE user_id = ? AND used_at IS NULL', [value.id])
      await revokeUserSessions(value.id, connection)
      return value
    })
    clearAuthCookies(res); await audit(req, 'password_reset_completed', user.id); await notify(req, user, 'your password was reset and all sessions were ended')
    res.json({ message: 'Your password has been reset. Sign in again with your new password.' })
  }))
  app.post('/api/auth/2fa/verify', route(async (req, res) => {
    const token = req.body?.challengeToken || req.cookies?.auth_pending
    const body = await authTransaction(pool, async connection => {
      const pending = await getChallenge(connection, token, 'login_mfa'), user = await userById(connection, pending.user_id, true)
      if (!user || Number(user.auth_version) !== pending.claims.version || !user.two_factor_enabled || !user.email_verified) throw new AuthError('Start sign-in again')
      if (!(await confirmFactor(connection, user, req.body?.code))) { await recordMfaFailure(connection, user.id); return attempt(connection)(pending) }
      await consume(connection, pending.id)
      return { user: publicUser(user), accessToken: await issueSession(res, user, { connection }) }
    })
    res.clearCookie('auth_pending', cookieOptions()); await audit(req, 'mfa_login_success', body.user.id); res.json(body)
  }))
  app.get('/api/auth/pending', route(async (req, res) => {
    const token = req.cookies?.auth_pending, claims = verifyToken(token, 'access', 'challenge')
    if (!['login_mfa', 'enroll_mfa'].includes(claims.kind)) throw new AuthError()
    await getChallenge(pool, token, claims.kind, false)
    res.json(claims.kind === 'login_mfa' ? { requiresTwoFactor: true, challengeToken: token } : { requiresMfaEnrollment: true, enrollmentToken: token })
  }))
  app.post('/api/auth/refresh', route(async (req, res) => {
    try {
      const raw = req.cookies?.refresh_token, claims = verifyRefresh(raw)
      if (typeof claims.sid !== 'string' || typeof claims.jti !== 'string') throw new AuthError()
      const outcome = await authTransaction(pool, async connection => {
        const user = await userById(connection, claims.sub, true)
        const [sessions] = await connection.execute('SELECT * FROM auth_sessions WHERE id = ? AND user_id = ? FOR UPDATE', [claims.sid, claims.sub])
        const session = sessions[0]
        if (!session || session.revoked_at || new Date(session.expires_at).getTime() <= Date.now()) throw new AuthError()
        const [tokens] = await connection.execute('SELECT * FROM refresh_tokens WHERE id = ? AND session_id = ? AND user_id = ? AND token_hash = ? FOR UPDATE', [claims.jti, claims.sid, claims.sub, hashToken(raw)])
        const current = tokens[0]
        if (!current || current.revoked_at || new Date(current.expires_at).getTime() <= Date.now()) {
          await connection.execute('UPDATE auth_sessions SET revoked_at = UTC_TIMESTAMP() WHERE id = ?', [claims.sid])
          await connection.execute('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE session_id = ?', [claims.sid])
          return { reused: true }
        }
        if (!user || !user.email_verified || (staffRoles.has(user.role) && !user.two_factor_enabled)) throw new AuthError()
        await connection.execute('UPDATE refresh_tokens SET revoked_at = UTC_TIMESTAMP() WHERE id = ?', [claims.jti])
        return { user: publicUser(user), accessToken: await issueSession(res, user, { connection, sessionId: session.id, authenticatedAt: session.authenticated_at, expiresAt: session.expires_at }) }
      })
      if (outcome.reused) { await audit(req, 'refresh_token_reuse', claims.sub); throw new AuthError('Your session has ended. Please sign in again.') }
      res.json(outcome)
    } catch (error) { if (error instanceof AuthError) clearAuthCookies(res); throw error }
  }))
  app.get('/api/me', authRequired, route(async (req, res) => { res.json({ user: publicUser(req.authUser) }) }))
  app.put('/api/me/profile', authRequired, route(async (req, res) => {
    const address = emailValue(req.body?.email)
    const phone = typeof req.body?.phone === 'string' ? req.body.phone.replace(/[\u0000-\u001F\u007F]/g, '').trim() : ''
    if (!validEmail(address)) throw new AuthError('Enter a valid email address.', 400)
    if (phone && (!/^\+?[\d\s().-]{6,32}$/.test(phone) || !/^\d{6,15}$/.test(phone.replace(/\D/g, '')))) throw new AuthError('Enter a valid mobile number or leave it blank.', 400)
    const result = await authTransaction(pool, async connection => {
      const user = await userById(connection, req.authUser.id, true)
      if (!user || user.role !== 'student') throw new AuthError('Student account profile not found.', 404)
      const changedEmail = emailValue(user.email) !== address
      if (changedEmail) {
        const [duplicates] = await connection.execute('SELECT id FROM users WHERE (email = ? OR pending_email = ?) AND id <> ? LIMIT 1', [address, address, user.id])
        if (duplicates[0]) throw new AuthError('That email address is already connected to an account.', 409)
      }
      await connection.execute('UPDATE users SET profile_phone = ?, pending_email = ? WHERE id = ?', [phone || null, changedEmail ? address : user.pending_email || null, user.id])
      if (changedEmail) {
        await connection.execute("UPDATE auth_challenges SET consumed_at = UTC_TIMESTAMP() WHERE user_id = ? AND kind = 'email_verify' AND consumed_at IS NULL", [user.id])
        const token = crypto.randomBytes(32).toString('hex')
        await challenge(connection, user, 'email_verify', { rawToken: token, payload: { pendingEmail: address }, lifetime: 1800 })
        return { user: { ...user, profile_phone: phone || null, pending_email: address }, verificationToken: token, changedEmail }
      }
      return { user: { ...user, profile_phone: phone || null, pending_email: user.pending_email || null }, verificationToken: null, changedEmail }
    })
    if (result.verificationToken) {
      try { await email.verification({ email: address, verificationUrl: `${baseUrl}/verify-email/${result.verificationToken}` }) }
      catch { await audit(req, 'verification_email_delivery_failed', result.user.id) }
      await audit(req, 'account_email_change_requested', result.user.id)
    }
    res.json({ user: publicUser(result.user), emailVerificationRequired: result.changedEmail, message: result.changedEmail ? 'Check the new email address and verify it before it becomes your sign-in email.' : 'Profile updated.' })
  }))
  app.post('/api/auth/logout', route(async (req, res) => {
    const targets = new Map()
    try {
      const claims = verifyRefresh(req.cookies?.refresh_token)
      if (typeof claims.sid === 'string') targets.set(claims.sid, claims.sub)
    } catch (error) { if (!(error instanceof AuthError)) throw error }
    if (req.get('authorization')) {
      try { await authenticateRequest(req); targets.set(req.user.sid, req.user.sub) }
      catch (error) { if (!(error instanceof AuthError)) throw error }
    }
    if (targets.size) await authTransaction(pool, async connection => {
      // Match refresh/reset/security changes: users first, then session rows.
      // A browser can hold a cookie and bearer for different accounts, so order
      // both sets deterministically before taking more than one row lock.
      for (const userId of [...new Set(targets.values())].sort()) await userById(connection, userId, true)
      for (const [sid, userId] of [...targets.entries()].sort(([left], [right]) => left.localeCompare(right))) {
        await connection.execute('UPDATE auth_sessions SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE id = ? AND user_id = ?', [sid, userId])
        await connection.execute('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE session_id = ?', [sid])
      }
    })
    clearAuthCookies(res)
    for (const userId of new Set(targets.values())) await audit(req, 'logout', userId)
    res.status(204).end()
  }))
  app.post('/api/auth/logout-all', authRequired, route(async (req, res) => {
    await authTransaction(pool, connection => revokeUserSessions(req.user.sub, connection))
    clearAuthCookies(res); await audit(req, 'logout_all', req.user.sub); res.status(204).end()
  }))
  app.get('/api/auth/google/start', route(async (req, res) => {
    const client = await getGoogle(), state = crypto.randomBytes(32).toString('base64url'), nonce = crypto.randomBytes(32).toString('base64url'), verifier = crypto.randomBytes(32).toString('base64url')
    await challenge(pool, null, 'oauth', { rawToken: state, secret: JSON.stringify({ nonce, verifier }), lifetime: 300 })
    res.cookie('oauth_state', state, { ...cookieOptions(), maxAge: 300000 })
    res.redirect(client.generateAuthUrl({ scope: ['openid', 'email', 'profile'], prompt: 'select_account', state, nonce, code_challenge: crypto.createHash('sha256').update(verifier).digest('base64url'), code_challenge_method: 'S256' }))
  }))
  app.get('/api/auth/google/callback', route(async (req, res) => {
    try {
      const state = req.query?.state, cookie = req.cookies?.oauth_state, code = req.query?.code
      if (typeof state !== 'string' || typeof cookie !== 'string' || typeof code !== 'string' || state.length > 128 || cookie.length !== state.length || !crypto.timingSafeEqual(Buffer.from(state), Buffer.from(cookie))) throw new AuthError('Google sign-in request expired. Try again.')
      const proof = await authTransaction(pool, async connection => {
        const [rows] = await connection.execute("SELECT * FROM auth_challenges WHERE kind = 'oauth' AND token_hash = ? AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE", [hashToken(state)])
        if (!rows[0]) throw new AuthError('Google sign-in request expired. Try again.')
        await consume(connection, rows[0].id); return JSON.parse(decrypt(rows[0].secret_enc))
      })
      res.clearCookie('oauth_state', cookieOptions())
      const client = await getGoogle(), { tokens } = await client.getToken({ code, codeVerifier: proof.verifier, redirect_uri: process.env.GOOGLE_CALLBACK_URL })
      const ticket = await client.verifyIdToken({ idToken: tokens.id_token, audience: process.env.GOOGLE_CLIENT_ID })
      const profile = validateGoogleProfile(ticket.getPayload(), proof.nonce)
      const outcome = await authTransaction(pool, async connection => {
        const [subjects] = await connection.execute('SELECT * FROM users WHERE google_subject = ? LIMIT 1 FOR UPDATE', [profile.sub])
        let user = subjects[0]
        if (!user) {
          const [existing] = await connection.execute('SELECT id FROM users WHERE email = ? LIMIT 1 FOR UPDATE', [emailValue(profile.email)])
          if (existing[0]) throw new AuthError('This email already has an account. Sign in with its password or reset the password. Google sign-in cannot silently link accounts.', 409, 'GOOGLE_LINK_REQUIRED')
          const id = crypto.randomUUID()
          await connection.execute('INSERT INTO users (id, email, google_subject, first_name, last_name, email_verified) VALUES (?, ?, ?, ?, ?, TRUE)', [id, emailValue(profile.email), profile.sub, nameValue(profile.given_name), nameValue(profile.family_name)])
          user = await userById(connection, id)
        }
        // Existing legacy Google accounts must verify the stored address too.
        return loginOutcome(connection, user, res)
      })
      if (outcome.body.requiresEmailVerification) return res.redirect(`${baseUrl}/?auth=verify_email`)
      if (outcome.status === 202) {
        res.cookie('auth_pending', outcome.body.challengeToken || outcome.body.enrollmentToken, { ...cookieOptions(), maxAge: 600000 })
        return res.redirect(`${baseUrl}/?auth=pending`)
      }
      await audit(req, 'google_login_success', outcome.body.user.id); res.redirect(`${baseUrl}/?auth=success`)
    } catch (error) {
      res.clearCookie('oauth_state', cookieOptions()); await audit(req, 'google_login_failed')
      if (error instanceof AuthError || error.code === 'ER_DUP_ENTRY') return res.redirect(`${baseUrl}/?auth=${error.code === 'GOOGLE_LINK_REQUIRED' || error.code === 'ER_DUP_ENTRY' ? 'account_exists' : 'failed'}`)
      // Provider errors may contain authorization codes. Do not log the provider
      // error object or allow the generic server logger to capture it.
      res.redirect(`${baseUrl}/?auth=failed`)
    }
  }))
  const securityStatus = route(async (req, res) => {
    const user = req.authUser
    const [rows] = await pool.execute('SELECT COUNT(*) AS remaining FROM auth_recovery_codes WHERE user_id = ? AND used_at IS NULL', [user.id])
    res.json({ emailVerified: Boolean(user.email_verified), twoFactorEnabled: Boolean(user.two_factor_enabled), hasPassword: Boolean(user.password_hash), recoveryCodesRemaining: Number(rows[0]?.remaining || 0), requiresRecentLogin: !user.password_hash && !user.two_factor_enabled && Date.now() - new Date(req.user.authenticatedAt).getTime() > 300000 })
  })
  app.get('/api/auth/security', authRequired, securityStatus)
  app.get('/api/security', authRequired, securityStatus)
  app.post('/api/2fa/setup', route(async (req, res) => {
    if (!req.body?.enrollmentToken) await authenticateRequest(req)
    const result = await authTransaction(pool, async connection => {
      const enrollment = req.body?.enrollmentToken ? await getChallenge(connection, req.body.enrollmentToken, 'enroll_mfa') : null
      const user = await userById(connection, enrollment?.user_id || req.user.sub, true)
      if (!user || !user.email_verified || (enrollment && (user.two_factor_enabled || Number(user.auth_version) !== enrollment.claims.version))) throw new AuthError('Start sign-in again')
      if (!enrollment) { await requireCurrentSession(connection, req, user); await securityProof(connection, req, user) }
      const secret = generateSecret()
      await connection.execute("UPDATE auth_challenges SET consumed_at = UTC_TIMESTAMP() WHERE user_id = ? AND kind = 'setup_mfa' AND consumed_at IS NULL", [user.id])
      const setupToken = await challenge(connection, user, 'setup_mfa', { secret, payload: { enrollmentId: enrollment?.id || null, sessionId: req.user?.sid || null } })
      return { user, secret, setupToken }
    })
    const qr = qrCode || (await import('qrcode')).default
    res.json({ manualKey: result.secret, qrCodeDataUrl: await qr.toDataURL(generateURI({ issuer: 'Student Advisor', label: result.user.email, secret: result.secret })), setupToken: result.setupToken })
  }))
  app.post('/api/2fa/enable', route(async (req, res) => {
    if (req.get('authorization')) await authenticateRequest(req)
    const result = await authTransaction(pool, async connection => {
      const setup = await getChallenge(connection, req.body?.setupToken, 'setup_mfa'), user = await userById(connection, setup.user_id, true)
      if (!user || !user.email_verified || Number(user.auth_version) !== setup.claims.version) throw new AuthError('Start setup again')
      if (setup.payload.enrollmentId) {
        const [rows] = await connection.execute("SELECT id FROM auth_challenges WHERE id = ? AND user_id = ? AND kind = 'enroll_mfa' AND consumed_at IS NULL AND expires_at > UTC_TIMESTAMP() LIMIT 1 FOR UPDATE", [setup.payload.enrollmentId, user.id])
        if (!rows[0] || user.two_factor_enabled) throw new AuthError('Start sign-in again')
      } else {
        await requireCurrentSession(connection, req, user)
        if (req.user.sid !== setup.payload.sessionId) throw new AuthError('Start setup again')
      }
      if (!/^\d{6}$/.test(String(req.body?.code || ''))) return attempt(connection)(setup)
      const verified = await verify({ token: req.body.code, secret: decrypt(setup.secret_enc), epochTolerance: 30 })
      if (!verified.valid) return attempt(connection)(setup)
      await connection.execute('UPDATE users SET two_factor_secret_enc = ?, two_factor_enabled = TRUE, totp_last_step = ? WHERE id = ?', [setup.secret_enc, verified.timeStep, user.id])
      const codes = await recoveryCodes(connection, user.id)
      await revokeUserSessions(user.id, connection)
      user.two_factor_enabled = true; user.auth_version = Number(user.auth_version || 0) + 1
      return { user: publicUser(user), accessToken: await issueSession(res, user, { connection }), recoveryCodes: codes }
    })
    res.clearCookie('auth_pending', cookieOptions()); await audit(req, 'mfa_enabled', result.user.id); await notify(req, result.user, 'two-step verification was enabled or changed'); res.json(result)
  }))
  app.post('/api/2fa/disable', authRequired, route(async (req, res) => {
    if (staffRoles.has(req.authUser.role)) throw new AuthError('Staff accounts must keep two-step verification enabled. Set up a replacement authenticator instead.', 403, 'MFA_REQUIRED')
    const result = await authTransaction(pool, async connection => {
      const user = await userById(connection, req.user.sub, true)
      await requireCurrentSession(connection, req, user)
      await securityProof(connection, req, user)
      await connection.execute('UPDATE users SET two_factor_enabled = FALSE, two_factor_secret_enc = NULL, totp_last_step = NULL WHERE id = ?', [user.id])
      await connection.execute('DELETE FROM auth_recovery_codes WHERE user_id = ?', [user.id])
      await revokeUserSessions(user.id, connection)
      user.two_factor_enabled = false; user.auth_version = Number(user.auth_version || 0) + 1
      return { enabled: false, user: publicUser(user), accessToken: await issueSession(res, user, { connection }) }
    })
    await audit(req, 'mfa_disabled', req.user.sub); await notify(req, result.user, 'two-step verification was disabled'); res.json(result)
  }))
  app.post('/api/2fa/recovery-codes', authRequired, route(async (req, res) => {
    const result = await authTransaction(pool, async connection => {
      const user = await userById(connection, req.user.sub, true)
      if (!user.two_factor_enabled) throw new AuthError('Enable two-step verification first.', 400)
      await requireCurrentSession(connection, req, user)
      await securityProof(connection, req, user)
      const codes = await recoveryCodes(connection, user.id)
      await revokeUserSessions(user.id, connection)
      user.auth_version = Number(user.auth_version || 0) + 1
      return { recoveryCodes: codes, user: publicUser(user), accessToken: await issueSession(res, user, { connection }) }
    })
    await audit(req, 'mfa_recovery_codes_replaced', req.user.sub); await notify(req, result.user, 'recovery codes were replaced'); res.json(result)
  }))
}

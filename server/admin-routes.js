import crypto from 'node:crypto'
import { verify } from 'otplib'
import { adminRequired, staffRequired, hashPassword, hashToken, decrypt, validatePassword, PASSWORD_MESSAGE, revokeUserSessions } from './security.js'
import { sendVerificationEmail } from './email.js'

const permissionKeys = ['adminPermissions', 'viewOnly', 'manageContent', 'advisorDashboard', 'advisorMessages', 'advisorStatusUpdates', 'advisorDocuments', 'advisorDeleteApplications']
const object = (value) => { if (value && typeof value === 'object' && !Array.isArray(value)) return value; try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} } catch { return {} } }
const permissions = (value) => Object.fromEntries(permissionKeys.map((key) => [key, object(value)[key] === true]))
const text = (value, max = 100) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
export function pagination(query, defaultLimit = 50) {
  const page = Math.max(1, Math.min(100000, Math.floor(Number(query.page) || 1)))
  const limit = Math.max(1, Math.min(100, Math.floor(Number(query.limit) || defaultLimit)))
  return { page, limit, offset: (page - 1) * limit }
}

export function registerAdminRoutes(app, { pool, logAuditAction, frontendUrl = process.env.FRONTEND_URL }) {
  const baseUrl = new URL(frontendUrl || 'http://localhost:5173').origin
  const log = (req, actionType, description, metadata) => logAuditAction({ userId: req.user.sub, actionType, description, metadata, ipAddress: req.ip })
  app.post('/api/admin/staff', adminRequired, handler(async (req, res) => {
    const email = text(req.body?.email, 255).toLowerCase()
    const { password, role } = req.body || {}
    if (!['advisor', 'moderator'].includes(role)) return res.status(400).json({ error: 'Choose adviser or moderator.' })
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !validatePassword(password)) return res.status(400).json({ error: `Enter a valid email. ${PASSWORD_MESSAGE}` })
    const firstName = text(req.body.firstName); const lastName = text(req.body.lastName)
    const [existing] = await pool.execute('SELECT id FROM users WHERE email = ? LIMIT 1', [email])
    if (existing.length) return res.status(409).json({ error: 'An account with that email already exists.' })
    const id = crypto.randomUUID()
    const grants = role === 'moderator' ? permissions({ viewOnly: true }) : {}
    await pool.execute('INSERT INTO users (id, email, password_hash, role, permissions, first_name, last_name) VALUES (?, ?, ?, ?, ?, ?, ?)', [id, email, await hashPassword(password), role, JSON.stringify(grants), firstName || null, lastName || null])
    await log(req, 'create_staff_account', 'Created a staff account requiring email verification and MFA enrollment', { targetUserId: id, role })
    res.status(201).json({ user: { id, email, firstName, lastName, role, permissions: grants }, message: 'The staff member must verify their email and enroll an authenticator before accessing records.' })
  }))
  app.get('/api/admin/users', staffRequired('viewOnly'), handler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const where = req.query.roleGroup === 'students' ? " WHERE role = 'student'" : req.query.roleGroup === 'staff' ? " WHERE role IN ('admin','advisor','moderator')" : ''
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total FROM users${where}`)
    const [rows] = await pool.query(`SELECT id, email, pending_email AS pendingEmail, role, permissions, first_name AS firstName, last_name AS lastName, created_at AS createdAt, updated_at AS updatedAt FROM users${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`, [limit, offset])
    res.json({ users: rows.map((user) => ({ ...user, blocked: object(user.permissions).staffBlocked === true, permissions: permissions(user.permissions) })), permissionKeys, page, limit, total: Number(count.total), hasMore: offset + rows.length < Number(count.total) })
  }))
  app.patch('/api/admin/users/:id/email', adminRequired, handler(async (req, res) => {
    const address = text(req.body?.email, 255).toLowerCase()
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return res.status(400).json({ error: 'Enter a valid email address.' })
    const connection = await pool.getConnection()
    let target, verificationToken
    try {
      await connection.beginTransaction()
      const [rows] = await connection.execute('SELECT * FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id])
      target = rows[0]
      if (!target || !['admin', 'advisor', 'moderator'].includes(target.role)) { await connection.rollback(); return res.status(404).json({ error: 'Staff account not found.' }) }
      if (target.role === 'admin' && (req.user.sub !== target.id || req.authUser.role !== 'admin')) { await connection.rollback(); return res.status(403).json({ error: 'Only the main administrator can change their own email address.' }) }
      if (target.role === 'admin') {
        const code = String(req.body?.code || '').replace(/[\s-]/g, '').toUpperCase()
        if (!target.two_factor_enabled || (target.mfa_locked_until && new Date(target.mfa_locked_until).getTime() > Date.now())) { await connection.rollback(); return res.status(403).json({ error: 'Enable two-step verification before changing the main administrator email.' }) }
        let verified = false
        if (/^\d{6}$/.test(code) && target.two_factor_secret_enc) {
          const factor = await verify({ token: code, secret: decrypt(target.two_factor_secret_enc), epochTolerance: 30 })
          if (factor.valid && (target.totp_last_step == null || Number(factor.timeStep) > Number(target.totp_last_step))) {
            await connection.execute('UPDATE users SET totp_last_step = ?, mfa_failures = 0, mfa_locked_until = NULL WHERE id = ?', [factor.timeStep, target.id]); verified = true
          }
        } else if (/^[0-9A-F]{32}$/.test(code)) {
          const [recovery] = await connection.execute('SELECT id FROM auth_recovery_codes WHERE user_id = ? AND code_hash = ? AND used_at IS NULL LIMIT 1 FOR UPDATE', [target.id, hashToken(code)])
          if (recovery[0]) { await connection.execute('UPDATE auth_recovery_codes SET used_at = UTC_TIMESTAMP() WHERE id = ?', [recovery[0].id]); verified = true }
        }
        if (!verified) {
          await connection.execute('UPDATE users SET mfa_failures = IF(mfa_locked_until IS NOT NULL AND mfa_locked_until <= UTC_TIMESTAMP(), 1, mfa_failures + 1), mfa_locked_until = IF(mfa_failures >= 10, DATE_ADD(UTC_TIMESTAMP(), INTERVAL 15 MINUTE), NULL) WHERE id = ?', [target.id])
          await connection.commit()
          return res.status(401).json({ error: 'Enter a valid, unused authenticator or recovery code.' })
        }
      }
      if (address === target.email) { await connection.commit(); return res.json({ updated: false, message: 'That is already the current email address.' }) }
      const [duplicates] = await connection.execute('SELECT id FROM users WHERE (email = ? OR pending_email = ?) AND id <> ? LIMIT 1', [address, address, target.id])
      if (duplicates[0]) { await connection.rollback(); return res.status(409).json({ error: 'That email address is already connected to an account.' }) }
      await connection.execute("UPDATE auth_challenges SET consumed_at = UTC_TIMESTAMP() WHERE user_id = ? AND kind = 'email_verify' AND consumed_at IS NULL", [target.id])
      verificationToken = crypto.randomBytes(32).toString('hex')
      await connection.execute('UPDATE users SET pending_email = ? WHERE id = ?', [address, target.id])
      await connection.execute('INSERT INTO auth_challenges (id, user_id, kind, token_hash, payload, expires_at) VALUES (?, ?, ?, ?, ?, ?)', [crypto.randomUUID(), target.id, 'email_verify', hashToken(verificationToken), JSON.stringify({ pendingEmail: address }), new Date(Date.now() + 30 * 60 * 1000)])
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    try { await sendVerificationEmail({ email: address, verificationUrl: `${baseUrl}/verify-email/${verificationToken}` }) }
    catch { await log(req, 'staff_email_verification_delivery_failed', 'Could not send staff email verification', { targetUserId: target.id, role: target.role }); return res.status(502).json({ error: 'The verification email could not be sent. Check mail settings and try again.' }) }
    await log(req, 'staff_email_change_requested', 'Requested a staff email change requiring verification', { targetUserId: target.id, role: target.role })
    res.json({ updated: true, pendingEmail: address, message: `A verification link was sent to ${address}. The sign-in email changes after it is verified.` })
  }))
  app.patch('/api/admin/staff/:id/block', adminRequired, handler(async (req, res) => {
    const blocked = req.body?.blocked
    if (typeof blocked !== 'boolean' || req.params.id === req.user.sub) return res.status(400).json({ error: 'Choose whether to block or unblock another staff account.' })
    const connection = await pool.getConnection()
    let role
    try {
      await connection.beginTransaction()
      const [rows] = await connection.execute('SELECT role, permissions FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id])
      if (!rows[0] || !['advisor', 'moderator'].includes(rows[0].role)) { await connection.rollback(); return res.status(404).json({ error: 'Adviser or moderator account not found.' }) }
      role = rows[0].role
      const grants = object(rows[0].permissions)
      if (blocked) grants.staffBlocked = true
      else delete grants.staffBlocked
      await connection.execute('UPDATE users SET permissions = ? WHERE id = ?', [JSON.stringify(grants), req.params.id])
      if (blocked) await revokeUserSessions(req.params.id, connection)
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    await log(req, blocked ? 'block_staff_account' : 'unblock_staff_account', blocked ? 'Temporarily blocked a staff account and revoked its sessions' : 'Restored a temporarily blocked staff account', { targetUserId: req.params.id, role })
    res.json({ updated: true, blocked, role })
  }))
  app.delete('/api/admin/staff/:id', adminRequired, handler(async (req, res) => {
    if (req.params.id === req.user.sub) return res.status(400).json({ error: 'You cannot delete your own account.' })
    const connection = await pool.getConnection()
    let role
    try {
      await connection.beginTransaction()
      const [rows] = await connection.execute('SELECT role FROM users WHERE id = ? LIMIT 1 FOR UPDATE', [req.params.id])
      if (!rows[0] || !['advisor', 'moderator'].includes(rows[0].role)) { await connection.rollback(); return res.status(404).json({ error: 'Adviser or moderator account not found.' }) }
      role = rows[0].role
      const [applications] = await connection.execute('SELECT id FROM applications WHERE user_id = ? LIMIT 1', [req.params.id])
      if (applications.length) { await connection.rollback(); return res.status(409).json({ error: 'This account owns an application. Change its role or transfer the application before deleting the account.' }) }
      await connection.execute('UPDATE audit_logs SET user_id = NULL WHERE user_id = ?', [req.params.id])
      await connection.execute('UPDATE site_content SET updated_by = ? WHERE updated_by = ?', [req.user.sub, req.params.id])
      await connection.execute('UPDATE support_messages SET user_id = NULL WHERE user_id = ?', [req.params.id])
      await connection.execute('DELETE FROM users WHERE id = ?', [req.params.id])
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    await log(req, 'delete_staff_account', 'Deleted a staff account while retaining audit and content history', { targetUserId: req.params.id, role })
    res.json({ deleted: true })
  }))
  app.patch('/api/admin/users/:id', staffRequired('adminPermissions'), handler(async (req, res) => {
    const firstName = text(req.body?.firstName); const lastName = text(req.body?.lastName)
    if (!firstName && !lastName) return res.status(400).json({ error: 'A first or last name is required.' })
    const [result] = await pool.execute('UPDATE users SET first_name = ?, last_name = ? WHERE id = ?', [firstName || null, lastName || null, req.params.id])
    if (!result.affectedRows) return res.status(404).json({ error: 'User not found' })
    await log(req, 'update_user', 'Updated user profile fields', { targetUserId: req.params.id })
    res.json({ updated: true })
  }))
  app.patch('/api/admin/users/:id/role', adminRequired, handler(async (req, res) => {
    const role = req.body?.role
    if (!['student', 'advisor', 'moderator'].includes(role) || req.params.id === req.user.sub) return res.status(400).json({ error: 'Choose a valid role for another account.' })
    const grants = role === 'moderator' ? permissions(req.body.permissions) : {}
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [result] = await connection.execute('UPDATE users SET role = ?, permissions = ? WHERE id = ? AND role <> ?', [role, JSON.stringify(grants), req.params.id, 'admin'])
      if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ error: 'Assignable account not found' }) }
      await revokeUserSessions(req.params.id, connection)
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    await log(req, 'update_user_role', 'Changed a user role and revoked existing sessions', { targetUserId: req.params.id, role })
    res.json({ updated: true, role, permissions: grants })
  }))
  app.patch('/api/admin/moderators/:id/permissions', adminRequired, handler(async (req, res) => {
    const grants = permissions(req.body?.permissions)
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [existing] = await connection.execute("SELECT permissions FROM users WHERE id = ? AND role = 'moderator' LIMIT 1 FOR UPDATE", [req.params.id])
      if (!existing[0]) { await connection.rollback(); return res.status(404).json({ error: 'Moderator not found' }) }
      if (object(existing[0].permissions).staffBlocked === true) grants.staffBlocked = true
      const [result] = await connection.execute("UPDATE users SET permissions = ? WHERE id = ? AND role = 'moderator'", [JSON.stringify(grants), req.params.id])
      if (!result.affectedRows) { await connection.rollback(); return res.status(404).json({ error: 'Moderator not found' }) }
      await revokeUserSessions(req.params.id, connection)
      await connection.commit()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
    await log(req, 'update_moderator_permissions', 'Updated moderator permissions and revoked existing sessions', { targetUserId: req.params.id, permissions: grants })
    res.json({ updated: true, permissions: grants })
  }))
  app.get('/api/admin/logs', staffRequired('viewOnly'), handler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const search = text(req.query.search, 100)
    const where = search ? ' WHERE l.action_type LIKE ? OR l.description LIKE ? OR u.email LIKE ?' : ''
    const values = search ? Array(3).fill(`%${search}%`) : []
    const from = ' FROM audit_logs l LEFT JOIN users u ON u.id = l.user_id'
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total${from}${where}`, values)
    const [rows] = await pool.query(`SELECT l.id, l.user_id AS userId, u.email, l.action_type AS actionType, l.description, l.metadata, l.ip_address AS ipAddress, l.created_at AS createdAt${from}${where} ORDER BY l.created_at DESC, l.id LIMIT ? OFFSET ?`, [...values, limit, offset])
    res.json({ logs: rows.map((row) => ({ ...row, metadata: object(row.metadata) })), page, limit, total: Number(count.total), hasMore: offset + rows.length < Number(count.total) })
  }))
  app.delete('/api/admin/logs/:id', adminRequired, (_req, res) => res.status(405).set('Allow', 'GET').json({ error: 'Audit history is retained and cannot be deleted through the website.' }))
}

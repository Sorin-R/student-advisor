import crypto from 'node:crypto'
import { adminRequired, staffRequired, hashPassword, validatePassword, PASSWORD_MESSAGE, revokeUserSessions } from './security.js'

const permissionKeys = ['viewOnly', 'editUsers', 'manageContent', 'advisorDashboard', 'advisorMessages', 'advisorStatusUpdates', 'advisorDocuments', 'advisorDeleteApplications']
const object = (value) => { if (value && typeof value === 'object' && !Array.isArray(value)) return value; try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} } catch { return {} } }
const permissions = (value) => Object.fromEntries(permissionKeys.map((key) => [key, object(value)[key] === true]))
const text = (value, max = 100) => typeof value === 'string' ? value.trim().slice(0, max) : ''
const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
export function pagination(query, defaultLimit = 50) {
  const page = Math.max(1, Math.min(100000, Math.floor(Number(query.page) || 1)))
  const limit = Math.max(1, Math.min(100, Math.floor(Number(query.limit) || defaultLimit)))
  return { page, limit, offset: (page - 1) * limit }
}

export function registerAdminRoutes(app, { pool, logAuditAction }) {
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
    const [rows] = await pool.query(`SELECT id, email, role, permissions, first_name AS firstName, last_name AS lastName, created_at AS createdAt, updated_at AS updatedAt FROM users${where} ORDER BY created_at DESC, id LIMIT ? OFFSET ?`, [limit, offset])
    res.json({ users: rows.map((user) => ({ ...user, permissions: permissions(user.permissions) })), permissionKeys, page, limit, total: Number(count.total), hasMore: offset + rows.length < Number(count.total) })
  }))
  app.patch('/api/admin/users/:id', staffRequired('editUsers'), handler(async (req, res) => {
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

import crypto from 'node:crypto'
import { advisorRequired, authRequired, authenticateRequest } from './security.js'
import { pagination } from './admin-routes.js'
import { sendSupportMessageEmail } from './email.js'

const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
const text = (value, maximum) => typeof value === 'string' && value.trim().length <= maximum ? value.trim() : ''

export function registerSupportRoutes(app, { pool, logAuditAction }) {
  app.post('/api/support-messages', handler(async (req, res) => {
    let name = text(req.body?.name, 200); let email = text(req.body?.email, 255).toLowerCase()
    const topic = text(req.body?.topic, 100); const message = text(req.body?.message, 5000)
    let userId = null
    if (req.get('authorization')?.startsWith('Bearer ')) {
      await authenticateRequest(req)
      userId = req.user.sub
      name = [req.authUser.first_name, req.authUser.last_name].filter(Boolean).join(' ') || req.authUser.email
      email = req.authUser.email
    }
    if (!topic || !message || (!userId && (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)))) return res.status(400).json({ error: 'Enter a valid name, email, subject and message.' })
    const id = crypto.randomUUID()
    // A visitor-supplied email is never proof of account ownership.
    await pool.execute('INSERT INTO support_messages (id, user_id, name, email, topic, message) VALUES (?, ?, ?, ?, ?, ?)', [id, userId, name, email, topic, message])
    if (userId) await pool.execute('UPDATE support_messages SET student_read_at = CURRENT_TIMESTAMP WHERE id = ?', [id])
    let emailNotified = true
    try { await sendSupportMessageEmail({ id, name, email, topic, message }) }
    catch (error) {
      console.error(JSON.stringify({ event: 'support_message_email_failed', messageId: id, code: error.code || error.name || 'Error' }))
      emailNotified = false
    }
    res.status(201).json({ sent: true, id, emailNotified })
  }))
  app.get('/api/support-messages', authRequired, handler(async (req, res) => {
    if (req.authUser?.role !== 'student') return res.status(403).json({ error: 'Student access is required.' })
    const [messages] = await pool.execute(`SELECT id, topic, message, created_at AS createdAt, updated_at AS updatedAt,
      (SELECT COUNT(*) FROM support_message_replies r WHERE r.support_message_id = support_messages.id AND r.sender_role <> 'student' AND (support_messages.student_read_at IS NULL OR r.created_at > support_messages.student_read_at)) AS unread
      FROM support_messages WHERE user_id = ? ORDER BY updated_at DESC, created_at DESC LIMIT 100`, [req.user.sub])
    res.json({ messages, unreadCount: messages.reduce((total, message) => total + Number(message.unread || 0), 0) })
  }))
  app.get('/api/support-messages/:id/thread', authRequired, handler(async (req, res) => {
    if (req.authUser?.role !== 'student') return res.status(403).json({ error: 'Student access is required.' })
    const [rows] = await pool.execute('SELECT id, name, email, topic, message, created_at AS createdAt FROM support_messages WHERE id = ? AND user_id = ? LIMIT 1', [req.params.id, req.user.sub])
    if (!rows[0]) return res.status(404).json({ error: 'Conversation not found.' })
    await pool.execute('UPDATE support_messages SET student_read_at = CURRENT_TIMESTAMP WHERE id = ? AND student_read_at IS NULL', [req.params.id])
    const [replies] = await pool.execute('SELECT id, sender_role AS senderRole, sender_name AS senderName, message, created_at AS createdAt FROM support_message_replies WHERE support_message_id = ? ORDER BY created_at, id', [req.params.id])
    res.json({ message: rows[0], replies })
  }))
  app.post('/api/support-messages/:id/replies', authRequired, handler(async (req, res) => {
    if (req.authUser?.role !== 'student') return res.status(403).json({ error: 'Student access is required.' })
    const message = text(req.body?.message, 5000)
    if (!message) return res.status(400).json({ error: 'Write a message before sending.' })
    const [rows] = await pool.execute('SELECT id FROM support_messages WHERE id = ? AND user_id = ? LIMIT 1', [req.params.id, req.user.sub])
    if (!rows[0]) return res.status(404).json({ error: 'Conversation not found.' })
    const id = crypto.randomUUID()
    const name = [req.authUser.first_name, req.authUser.last_name].filter(Boolean).join(' ') || req.authUser.email
    await pool.execute('INSERT INTO support_message_replies (id, support_message_id, sender_user_id, sender_role, sender_name, message) VALUES (?, ?, ?, \'student\', ?, ?)', [id, req.params.id, req.user.sub, name, message])
    await pool.execute('UPDATE support_messages SET read_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id])
    res.status(201).json({ sent: true, id })
  }))
  app.get('/api/advisor/support-messages/:id/thread', advisorRequired('advisorMessages'), handler(async (req, res) => {
    const [rows] = await pool.execute('SELECT id, name, email, topic, message, created_at AS createdAt FROM support_messages WHERE id = ? LIMIT 1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Message not found.' })
    await pool.execute('UPDATE support_messages SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ?', [req.params.id])
    const [replies] = await pool.execute('SELECT id, sender_role AS senderRole, sender_name AS senderName, message, created_at AS createdAt FROM support_message_replies WHERE support_message_id = ? ORDER BY created_at, id', [req.params.id])
    res.json({ message: rows[0], replies })
  }))
  app.post('/api/advisor/support-messages/:id/replies', advisorRequired('advisorMessages'), handler(async (req, res) => {
    const message = text(req.body?.message, 5000)
    if (!message) return res.status(400).json({ error: 'Write a reply before sending.' })
    const [rows] = await pool.execute('SELECT id FROM support_messages WHERE id = ? LIMIT 1', [req.params.id])
    if (!rows[0]) return res.status(404).json({ error: 'Message not found.' })
    const id = crypto.randomUUID()
    const senderRole = ['advisor', 'moderator', 'admin'].includes(req.user.role) ? req.user.role : 'advisor'
    const name = [req.authUser?.first_name, req.authUser?.last_name].filter(Boolean).join(' ') || 'Student Advisor'
    await pool.execute('INSERT INTO support_message_replies (id, support_message_id, sender_user_id, sender_role, sender_name, message) VALUES (?, ?, ?, ?, ?, ?)', [id, req.params.id, req.user.sub, senderRole, name, message])
    await pool.execute('UPDATE support_messages SET student_read_at = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [req.params.id])
    res.status(201).json({ sent: true, id })
  }))
  app.get('/api/advisor/support-messages', advisorRequired('advisorMessages'), handler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const search = text(req.query.search, 200)
    const status = ['unread', 'read'].includes(req.query.status) ? req.query.status : 'all'
    const sort = ['oldest', 'unread_first'].includes(req.query.sort) ? req.query.sort : 'newest'
    const where = ['WHERE (? = \'all\' OR (? = \'unread\' AND read_at IS NULL) OR (? = \'read\' AND read_at IS NOT NULL))', '(? = \'\' OR name LIKE ? OR email LIKE ? OR topic LIKE ? OR message LIKE ?)'].join(' AND ')
    const searchTerm = `%${search}%`
    const filters = [status, status, status, search, searchTerm, searchTerm, searchTerm, searchTerm]
    const [[count]] = await pool.query(`SELECT COUNT(*) AS total, COALESCE(SUM(read_at IS NULL), 0) AS unreadCount FROM support_messages ${where}`, filters)
    const orderBy = sort === 'oldest' ? 'updated_at ASC, id ASC' : sort === 'unread_first' ? 'read_at IS NOT NULL ASC, updated_at DESC, id DESC' : 'updated_at DESC, id DESC'
    const [messages] = await pool.query(`SELECT id, name, email, topic, message, read_at AS readAt, created_at AS createdAt, updated_at AS updatedAt FROM support_messages ${where} ORDER BY ${orderBy} LIMIT ? OFFSET ?`, [...filters, limit, offset])
    res.json({ messages, page, limit, total: Number(count.total), unreadCount: Number(count.unreadCount), hasMore: offset + messages.length < Number(count.total) })
  }))
  app.patch('/api/advisor/support-messages/:id/read', advisorRequired('advisorMessages'), handler(async (req, res) => {
    const [result] = await pool.execute('UPDATE support_messages SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ?', [req.params.id])
    if (!result.affectedRows) return res.status(404).json({ error: 'Message not found' })
    await logAuditAction({ userId: req.user.sub, actionType: 'advisor_mark_support_message_read', description: 'Marked a support message as read', metadata: { messageId: req.params.id }, ipAddress: req.ip })
    res.json({ read: true })
  }))
  app.delete('/api/advisor/support-messages/:id', advisorRequired('advisorMessages'), handler(async (req, res) => {
    const [result] = await pool.execute('DELETE FROM support_messages WHERE id = ?', [req.params.id])
    if (!result.affectedRows) return res.status(404).json({ error: 'Message not found' })
    await logAuditAction({ userId: req.user.sub, actionType: 'advisor_delete_support_message', description: 'Deleted a support message', metadata: { messageId: req.params.id }, ipAddress: req.ip })
    res.json({ deleted: true })
  }))
}

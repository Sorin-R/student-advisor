import crypto from 'node:crypto'
import { advisorRequired, authenticateRequest } from './security.js'
import { pagination } from './admin-routes.js'

const handler = (fn) => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
const text = (value, maximum) => typeof value === 'string' && value.trim().length <= maximum ? value.trim() : ''

export function registerSupportRoutes(app, { pool, logAuditAction }) {
  app.post('/api/support-messages', handler(async (req, res) => {
    const name = text(req.body?.name, 200); const email = text(req.body?.email, 255).toLowerCase()
    const topic = text(req.body?.topic, 100); const message = text(req.body?.message, 5000)
    if (!name || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !topic || !message) return res.status(400).json({ error: 'Enter a valid name, email, topic and message.' })
    let userId = null
    if (req.get('authorization')?.startsWith('Bearer ')) { await authenticateRequest(req); userId = req.user.sub }
    const id = crypto.randomUUID()
    // A visitor-supplied email is never proof of account ownership.
    await pool.execute('INSERT INTO support_messages (id, user_id, name, email, topic, message) VALUES (?, ?, ?, ?, ?, ?)', [id, userId, name, email, topic, message])
    res.status(201).json({ sent: true, id })
  }))
  app.get('/api/advisor/support-messages', advisorRequired('advisorMessages'), handler(async (req, res) => {
    const { page, limit, offset } = pagination(req.query)
    const [[count]] = await pool.query('SELECT COUNT(*) AS total, COALESCE(SUM(read_at IS NULL), 0) AS unreadCount FROM support_messages')
    const [messages] = await pool.query('SELECT id, name, email, topic, message, read_at AS readAt, created_at AS createdAt FROM support_messages ORDER BY created_at DESC, id LIMIT ? OFFSET ?', [limit, offset])
    res.json({ messages, page, limit, total: Number(count.total), unreadCount: Number(count.unreadCount), hasMore: offset + messages.length < Number(count.total) })
  }))
  app.patch('/api/advisor/support-messages/:id/read', advisorRequired('advisorMessages'), handler(async (req, res) => {
    const [result] = await pool.execute('UPDATE support_messages SET read_at = COALESCE(read_at, CURRENT_TIMESTAMP) WHERE id = ?', [req.params.id])
    if (!result.affectedRows) return res.status(404).json({ error: 'Message not found' })
    await logAuditAction({ userId: req.user.sub, actionType: 'advisor_mark_support_message_read', description: 'Marked a support message as read', metadata: { messageId: req.params.id }, ipAddress: req.ip })
    res.json({ read: true })
  }))
}

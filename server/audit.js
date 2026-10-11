import crypto from 'node:crypto'
import { appendFile } from 'node:fs/promises'
import { pool } from './db.js'

function safeMetadata(value, depth = 0) {
  if (depth > 5) return '[omitted]'
  if (Array.isArray(value)) return value.slice(0, 100).map((item) => safeMetadata(item, depth + 1))
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).slice(0, 100).map(([key, item]) => [key, /password|token|secret|authorization|recovery.?code|otp|credential/i.test(key) ? '[redacted]' : safeMetadata(item, depth + 1)]))
  return typeof value === 'string' ? value.slice(0, 1000) : value
}

export function createAuditLogger(databasePool, env = process.env) {
  return async ({ userId = null, actionType, description, metadata = null, ipAddress = null }) => {
    if (!actionType || !description) return
    const entry = { id: crypto.randomUUID(), userId, actionType: String(actionType).slice(0, 80), description: String(description).slice(0, 500), metadata: metadata ? safeMetadata(metadata) : null, ipAddress: String(ipAddress || '').slice(0, 64) || null }
    await databasePool.execute('INSERT INTO audit_logs (id, user_id, action_type, description, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)', [entry.id, entry.userId, entry.actionType, entry.description, entry.metadata ? JSON.stringify(entry.metadata) : null, entry.ipAddress])
    if (env.AUDIT_LOG_PATH) {
      try { await appendFile(env.AUDIT_LOG_PATH, JSON.stringify({ ...entry, recordedAt: new Date().toISOString() }) + '\n', { mode: 0o600 }) }
      catch { console.error(JSON.stringify({ event: 'audit_copy_failed', auditId: entry.id })) }
    }
  }
}
export const logAuditAction = createAuditLogger(pool)

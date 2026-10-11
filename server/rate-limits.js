import crypto from 'node:crypto'
import { ipKeyGenerator } from 'express-rate-limit'

// MySQL is shared by all app instances. A restart must not reset abuse limits.
export function mysqlCounter(pool) {
  let calls = 0
  return async (key, windowMs) => {
    const hash = crypto.createHash('sha256').update(key).digest('hex')
    const seconds = Math.ceil(windowMs / 1000)
    await pool.execute(`INSERT INTO request_limits (bucket_key, hits, expires_at)
      VALUES (?, 1, DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND))
      ON DUPLICATE KEY UPDATE
        hits = IF(expires_at <= UTC_TIMESTAMP(), 1, hits + 1),
        expires_at = IF(expires_at <= UTC_TIMESTAMP(), DATE_ADD(UTC_TIMESTAMP(), INTERVAL ? SECOND), expires_at)`, [hash, seconds, seconds])
    const [rows] = await pool.execute('SELECT hits, GREATEST(1, TIMESTAMPDIFF(SECOND, UTC_TIMESTAMP(), expires_at)) AS retry_after FROM request_limits WHERE bucket_key = ?', [hash])
    if (++calls % 200 === 0) await pool.execute('DELETE FROM request_limits WHERE expires_at < UTC_TIMESTAMP() LIMIT 1000')
    return { hits: Number(rows[0].hits), retryAfter: Number(rows[0].retry_after) }
  }
}

export function createRateLimiter({ consume, name, limit, windowMs, skip = () => false }) {
  return async (req, res, next) => {
    if (skip(req)) return next()
    try {
      const identity = req.user?.sub || ipKeyGenerator(req.ip || req.socket?.remoteAddress || 'unknown')
      const { hits, retryAfter } = await consume(`${name}:${identity}`, windowMs)
      res.set('RateLimit-Limit', String(limit))
      res.set('RateLimit-Remaining', String(Math.max(0, limit - hits)))
      res.set('RateLimit-Reset', String(retryAfter))
      if (hits > limit) {
        res.set('Retry-After', String(retryAfter))
        return res.status(429).json({ error: 'Too many requests. Please wait and try again.' })
      }
      next()
    } catch (error) { next(error) }
  }
}

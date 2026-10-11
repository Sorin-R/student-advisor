import { loadPrivacyNotice } from './privacy.js'

export async function checkProductionConfig(env = process.env) {
  const errors = []
  const warnings = []
  const requireValue = (key) => { if (!env[key] || /^(?:change-me|replace-with|your-)/i.test(env[key])) errors.push(`${key} must be configured.`) }
  for (const key of ['MYSQL_HOST', 'MYSQL_DATABASE', 'MYSQL_USER', 'MYSQL_PASSWORD', 'JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'TWO_FACTOR_ENCRYPTION_KEY', 'FRONTEND_URL', 'SMTP_HOST', 'SMTP_USER', 'SMTP_PASSWORD', 'EMAIL_FROM']) requireValue(key)
  if (env.NODE_ENV !== 'production') errors.push('NODE_ENV must be production for a deployment check.')
  for (const key of ['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET']) if ((env[key] || '').length < 32) errors.push(`${key} must contain at least 32 characters of independent random material.`)
  if (env.JWT_ACCESS_SECRET === env.JWT_REFRESH_SECRET) errors.push('JWT access and refresh secrets must be different.')
  if (!/^[a-f\d]{64}$/i.test(env.TWO_FACTOR_ENCRYPTION_KEY || '')) errors.push('TWO_FACTOR_ENCRYPTION_KEY must be a 32-byte hex key.')
  try { const url = new URL(env.FRONTEND_URL); if (url.protocol !== 'https:' || url.pathname !== '/' || url.search || url.hash || url.username || url.password) throw new Error() } catch { errors.push('FRONTEND_URL must be the exact public HTTPS origin, without a path or credentials.') }
  if (!env.TRUST_PROXY || env.TRUST_PROXY === 'true') errors.push('TRUST_PROXY must be explicitly set to false, verified proxy addresses/subnets, or a verified hop count.')
  if (env.MYSQL_USER === 'root') errors.push('Use a dedicated least-privilege database user, not root.')
  if (!['localhost', '127.0.0.1', '::1'].includes(env.MYSQL_HOST) && env.MYSQL_SSL !== 'true') errors.push('Remote MySQL must use certificate-verified TLS (MYSQL_SSL=true).')
  if (!await loadPrivacyNotice(env.PRIVACY_NOTICE_PATH)) errors.push('PRIVACY_NOTICE_PATH must point to a completed, approved privacy notice JSON file.')
  if (env.GOOGLE_CLIENT_ID && !env.GOOGLE_CLIENT_ID.includes('your-google')) {
    requireValue('GOOGLE_CLIENT_SECRET')
    if (env.GOOGLE_CALLBACK_URL !== `${(env.FRONTEND_URL || '').replace(/\/$/, '')}/api/auth/google/callback`) errors.push('GOOGLE_CALLBACK_URL must match the public origin and /api/auth/google/callback.')
  }
  if (!env.AUDIT_LOG_PATH) warnings.push('Configure AUDIT_LOG_PATH and protected log shipping/retention for an independent audit copy.')
  warnings.push('Verify hosting/CDN preserves CSP and no-store headers; test proxy IP handling, mail delivery, backups, restore and database grants before release.')
  return { errors: [...new Set(errors)], warnings }
}

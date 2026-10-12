import 'dotenv/config'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import express from 'express'
import { pool } from './db.js'
import { registerAuthRoutes } from './auth-routes.js'
import { registerApplicationRoutes } from './application-routes.js'
import { registerAdminRoutes } from './admin-routes.js'
import { registerSupportRoutes } from './support-routes.js'
import { registerContentRoutes } from './content-routes.js'
import { validateSecurityConfig } from './security.js'
import { createAuditLogger } from './audit.js'
import { installHttpMiddleware, installBrowserRoutes, errorHandler } from './http.js'
import { buildApplicationPdf } from './pdf.js'
import { createLegacyReader } from './legacy-documents.js'
import { loadPrivacyNotice } from './privacy.js'
import { checkProductionConfig } from './config-check.js'
import { assertAuthSchema } from './auth-migrations.js'
import { assertHardeningSchema } from './hardening-migrations.js'
import { assertSupportSchema } from './support-migrations.js'
import { registerAnalyticsRoutes } from './analytics-routes.js'

export async function createApp({ dbPool = pool, env = process.env, authOptions = {}, httpOptions = {}, applicationOptions = {}, serveClient = env.NODE_ENV === 'production' } = {}) {
  const app = express()
  const frontendUrl = new URL(env.FRONTEND_URL || 'http://localhost:5173').origin
  const uploadsDir = path.resolve(env.UPLOADS_DIR || './uploads')
  const clientBuildDir = path.resolve(env.CLIENT_BUILD_DIR || './dist')
  const logAuditAction = createAuditLogger(dbPool, env)
  const privacy = await loadPrivacyNotice(env.PRIVACY_NOTICE_PATH)
  installHttpMiddleware(app, { pool: dbPool, frontendUrl, env, ...httpOptions })
  app.get('/api/health', (_req, res) => res.json({ ok: true }))
  app.get('/api/privacy', (_req, res) => privacy ? res.json(privacy) : res.status(503).json({ error: 'Privacy information is temporarily unavailable. Please contact Student Advisor before sending personal documents.' }))
  registerAuthRoutes(app, { pool: dbPool, frontendUrl, logAuditAction, ...authOptions })
  registerSupportRoutes(app, { pool: dbPool, logAuditAction })
  registerApplicationRoutes(app, { pool: dbPool, uploadsDir, buildApplicationPdf, readLegacyUploadedFile: createLegacyReader(uploadsDir), ...applicationOptions })
  registerAdminRoutes(app, { pool: dbPool, logAuditAction })
  registerAnalyticsRoutes(app, { pool: dbPool })
  registerContentRoutes(app, { pool: dbPool, uploadsDir, logAuditAction })
  if (serveClient) installBrowserRoutes(app, clientBuildDir)
  else app.use((_req, res) => res.status(404).json({ error: 'Endpoint not found' }))
  app.use(errorHandler)
  return app
}

export async function startServer() {
  validateSecurityConfig()
  if (process.env.NODE_ENV === 'production') {
    const configuration = await checkProductionConfig()
    if (configuration.errors.length) throw new Error(`Deployment configuration is incomplete: ${configuration.errors.join(' ')}`)
    await assertAuthSchema(pool)
    await assertHardeningSchema(pool)
    await assertSupportSchema(pool)
  } else {
    const { migrateDatabase } = await import('./migrate.js')
    await migrateDatabase()
  }
  const app = await createApp()
  const port = Number(process.env.PORT || 4000)
  const host = process.env.HOST || (process.env.NODE_ENV === 'production' ? '0.0.0.0' : '127.0.0.1')
  const server = app.listen(port, host, () => console.log(`Student Advisor listening on ${host}:${port}`))
  server.requestTimeout = 30_000
  server.headersTimeout = 15_000
  server.keepAliveTimeout = 5_000
  return server
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startServer().catch((error) => { console.error('Server startup failed:', error.message); process.exitCode = 1; pool.end().catch(() => {}) })
}

import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import express from 'express'
import helmet from 'helmet'
import cors from 'cors'
import cookieParser from 'cookie-parser'
import { createRateLimiter, mysqlCounter } from './rate-limits.js'

export function originProtection(frontendUrl) {
  const allowedOrigin = new URL(frontendUrl).origin
  return (req, res, next) => {
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next()
    const origin = req.get('origin')
    const site = req.get('sec-fetch-site')
    if ((origin && origin !== allowedOrigin) || (site && !['same-origin', 'none'].includes(site))) {
      return res.status(403).json({ error: 'This request must come from the Student Advisor website.' })
    }
    // Browsers supply Origin on mutating fetches. Non-browser bearer clients
    // can omit it; cookie-authenticated changes must be browser-bound.
    if (!origin && site !== 'same-origin' && !req.get('authorization')?.startsWith('Bearer ')) {
      return res.status(403).json({ error: 'A same-origin request is required.' })
    }
    next()
  }
}

export function installHttpMiddleware(app, { pool, frontendUrl, env = process.env, consume = mysqlCounter(pool) }) {
  app.disable('x-powered-by')
  if (env.TRUST_PROXY && env.TRUST_PROXY !== 'false') {
    if (env.TRUST_PROXY === 'true') throw new Error('TRUST_PROXY must name trusted proxy addresses/subnets or an exact hop count, not true')
    app.set('trust proxy', /^\d+$/.test(env.TRUST_PROXY) ? Number(env.TRUST_PROXY) : env.TRUST_PROXY.split(',').map((part) => part.trim()))
  }
  app.use((req, res, next) => {
    req.requestId = crypto.randomUUID()
    res.set('X-Request-Id', req.requestId)
    next()
  })
  app.use(helmet({
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", 'https://maps.googleapis.com', 'https://maps.gstatic.com'],
      scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      imgSrc: ["'self'", 'data:', 'blob:', 'https://maps.googleapis.com', 'https://maps.gstatic.com', 'https://images.unsplash.com', 'https://placehold.co'],
      fontSrc: ["'self'", 'data:', 'https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'https://maps.googleapis.com', 'https://places.googleapis.com', 'https://maps.gstatic.com'],
      objectSrc: ["'none'"], baseUri: ["'self'"], frameAncestors: ["'none'"], formAction: ["'self'"],
      frameSrc: ["'self'", 'blob:', 'https://www.google.com'],
      upgradeInsecureRequests: env.NODE_ENV === 'production' ? [] : null,
    } },
    referrerPolicy: { policy: 'no-referrer' },
    frameguard: { action: 'deny' },
    strictTransportSecurity: env.NODE_ENV === 'production' ? { maxAge: 31536000, includeSubDomains: true } : false,
  }))
  app.use((_req, res, next) => { res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=()'); next() })
  app.use(cors({ origin: new URL(frontendUrl).origin, credentials: true }))
  app.use(cookieParser())
  app.use('/api', (_req, res, next) => { res.set('Cache-Control', 'no-store, private'); res.set('Pragma', 'no-cache'); next() })
  app.use('/api', originProtection(frontendUrl))
  const limiter = (name, limit, minutes, skip) => createRateLimiter({ consume, name, limit, windowMs: minutes * 60_000, skip })
  // Ending a session remains possible after another API or login budget is
  // exhausted. Origin checks still run first and logout has its own short cap.
  const isLogout = (req) => req.method === 'POST' && /^\/auth\/logout(?:-all)?\/?$/i.test(req.path)
  app.use('/api', limiter('api', 240, 1, (req) => ['/health', '/privacy'].includes(req.path) || isLogout(req)))
  const authenticationAttempt = /^\/(?:login|register|google\/(?:start|callback)|2fa\/verify)\/?$/i
  const sessionMaintenance = /^\/(?:refresh|pending|security)\/?$/i
  app.use('/api/auth', limiter('auth', 30, 15, (req) => !authenticationAttempt.test(req.path)))
  app.use('/api/auth', limiter('auth-session', 120, 1, (req) => !sessionMaintenance.test(req.path)))
  app.post(['/api/auth/logout', '/api/auth/logout-all'], limiter('logout', 60, 1))
  for (const route of ['/api/auth/forgot-password', '/api/auth/reset-password', '/api/auth/resend-verification', '/api/auth/verification/resend']) app.use(route, limiter('recovery', 5, 15))
  app.use('/api/2fa', limiter('mfa', 20, 15))
  app.post('/api/support-messages', limiter('support', 5, 15))
  app.patch('/api/application/documents', limiter('upload', 12, 15))
  const json = express.json({ limit: '64kb', strict: true })
  app.use((req, res, next) => req.method === 'PATCH' && req.path === '/api/application/documents' ? next() : json(req, res, next))
}

export function installBrowserRoutes(app, clientBuildDir) {
  let seoManifest = {}
  try { seoManifest = JSON.parse(fs.readFileSync(path.join(clientBuildDir, 'seo-manifest.json'), 'utf8')) } catch { /* Older builds fall back to the SPA shell. */ }
  app.use('/api', (_req, res) => res.status(404).json({ error: 'API endpoint not found' }))
  app.use(express.static(clientBuildDir, { dotfiles: 'deny', index: false, setHeaders(res, file) {
    res.set('Cache-Control', /\/assets\/[^/]+-[\w-]+\.[a-z]+$/.test(file) ? 'public, max-age=31536000, immutable' : 'no-cache')
  } }))
  const browserRoute = /^\/(?:$|terms\/?$|privacy\/?$|advisor(?:\/.*)?$|admin(?:\/.*)?$|forgot-password\/?$|reset-password\/[^/]+\/?$|verify-email(?:\/[^/]+)?\/?$|(?:en|ro)(?:\/.*)?$|free-student-advisory\/?$|study-in-uk\/?$|university-admission\/?$|student-visa-costs\/?$|editorial-policy\/?$|blog(?:\/[^/]+)?\/?$|universities\/[^/]+\/?$)/
  app.get(browserRoute, (req, res) => {
    const key = req.path.length > 1 ? req.path.replace(/\/+$/, '') : req.path
    const prerendered = seoManifest[key] || seoManifest[req.path]
    if (!prerendered && (/^\/(?:admin|advisor|forgot-password|reset-password|verify-email)(?:\/|$)/.test(key) || (key === '/' && (req.query.apply || req.query.auth)))) res.set('X-Robots-Tag', 'noindex, nofollow')
    res.set('Cache-Control', prerendered ? 'public, max-age=0, must-revalidate' : 'no-store')
    res.sendFile(prerendered || 'index.html', { root: clientBuildDir })
  })
  app.use((_req, res) => res.status(404).type('text').send('Page not found'))
}

export function errorHandler(error, req, res, next) {
  if (res.headersSent) return next(error)
  const status = Number.isInteger(error.status) && error.status >= 400 && error.status < 600 ? error.status : 500
  if (status >= 500) console.error(JSON.stringify({ event: 'request_error', requestId: req.requestId, code: error.code || error.name || 'Error' }))
  const errorMessage = status === 413 ? 'This request is too large.' : status === 400 && error.type === 'entity.parse.failed' ? 'Enter valid request data.' : status < 500 ? error.message : 'Unable to complete this request. Please try again.'
  res.status(status).json({ error: errorMessage, requestId: req.requestId })
}

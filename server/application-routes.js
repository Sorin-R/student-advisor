import crypto from 'node:crypto'
import path from 'node:path'
import { lstat, realpath, rm } from 'node:fs/promises'
import express from 'express'
import rateLimit from 'express-rate-limit'
import { pool as defaultPool } from './db.js'
import { authRequired, advisorRequired } from './security.js'
import { DOCUMENT_KEYS, REQUIRED_APPLICATION_FIELDS, TERMS_VERSION, applicationProgress, sanitizeApplicationData, validateApplicationData } from '../shared/application-schema.js'
import { MAX_DOCUMENT_BYTES, decodeDocument, safeDocumentName, validateDocument } from './document-validation.js'

const fail = (status, message, code) => Object.assign(new Error(message), { status, ...(code ? { code } : {}) })
const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)
const text = (value, max = 255) => typeof value === 'string' ? value.replace(/[\u0000-\u001F\u007F]/g, '').slice(0, max) : ''
function object(value) { if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return {} } } return isRecord(value) ? value : {} }
function documentKeys(value) { if (typeof value === 'string') { try { value = JSON.parse(value) } catch { return [] } } return Array.isArray(value) ? [...new Set(value.filter((key) => DOCUMENT_KEYS.includes(key)))] : [] }
const date = (value) => { try { const parsed = new Date(value); return value && Number.isFinite(parsed.getTime()) ? parsed.toISOString() : null } catch { return null } }
const documentStates = ['pending', 'submitted', 'accepted', 'rejected']
const selectApplication = `SELECT a.id, a.user_id AS userId, a.data, a.requested_documents AS requestedDocuments,
  a.document_submissions AS documentSubmissions, a.status, a.version, a.terms_version AS termsVersion,
  a.terms_accepted_at AS termsAcceptedAt, a.created_at AS createdAt, a.updated_at AS updatedAt,
  u.email, u.first_name AS firstName, u.last_name AS lastName FROM applications a INNER JOIN users u ON u.id = a.user_id`

export function safeLegacyName(applicationId, storageName) {
  if (typeof storageName !== 'string' || storageName.includes('\0') || storageName.includes('\\')) return null
  const parts = storageName.split('/')
  if (parts.length !== 2 || parts[0] !== applicationId || !parts[1] || parts[1] === '.' || parts[1] === '..') return null
  return storageName
}

export function cleanSubmissions(value, applicationId) {
  const incoming = object(value)
  const result = {}
  for (const key of DOCUMENT_KEYS) {
    if (!isRecord(incoming[key])) continue
    const item = incoming[key]
    const mimeType = ['application/pdf', 'image/jpeg', 'image/png'].includes(item.mimeType) ? item.mimeType : null
    result[key] = {
      status: documentStates.includes(item.status) ? item.status : 'pending',
      ...(mimeType ? { mimeType, fileName: safeDocumentName(item.fileName, mimeType) } : {}),
      ...(safeLegacyName(applicationId, item.storageName) ? { storageName: item.storageName } : {}),
      ...(date(item.submittedAt) ? { submittedAt: date(item.submittedAt) } : {}),
      ...(date(item.reviewedAt) ? { reviewedAt: date(item.reviewedAt) } : {}),
    }
  }
  return result
}

export function assertVersion(row, supplied) {
  if (!Number.isInteger(supplied) || supplied < 0) throw fail(428, 'Refresh the application before making changes; its version is required.')
  if (supplied !== (row ? Number(row.version) : 0)) throw fail(409, 'This application changed in another session. Refresh it before saving again.')
}

export function studentStatus(current, requested) {
  if (!['draft', 'submitted'].includes(requested)) throw fail(400, 'Students may save drafts or submit applications only.')
  if (current === 'complete') throw fail(409, 'This application is locked. Ask your adviser to reopen it.')
  if (current === 'in_review' || current === 'offer_received') return current
  if (current === 'submitted') return 'submitted'
  return requested
}

export async function cleanupLegacyApplication(uploadsDir, id) {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return
  try {
    const root = await realpath(uploadsDir)
    const candidate = path.join(root, id)
    const info = await lstat(candidate)
    if (!info.isDirectory() || info.isSymbolicLink()) return
    const actual = await realpath(candidate)
    if (actual !== candidate || path.dirname(actual) !== root) return
    // Only this application's directory in the current upload root. Never old deployments/backups.
    await rm(actual, { recursive: true, force: false })
  } catch (error) { if (error.code !== 'ENOENT') throw error }
}

export function registerApplicationRoutes(app, options = {}) {
  const pool = options.pool || defaultPool
  const authenticate = options.authRequired || authRequired
  const adviser = options.advisorRequired || advisorRequired
  const validate = options.validateDocument || validateDocument
  const uploadsDir = options.uploadsDir || path.resolve('./uploads')
  const route = (handler) => async (req, res, next) => {
    try { await handler(req, res) } catch (error) {
      if ([400, 403, 404, 409, 413, 415, 422, 428, 503].includes(error.status)) return res.status(error.status).json({ error: error.message, ...(error.code ? { code: error.code } : {}) })
      next(error)
    }
  }
  const limiter = (limit) => rateLimit({ windowMs: 15 * 60 * 1000, limit, standardHeaders: true, legacyHeaders: false, keyGenerator: (req) => req.user.sub })
  const writes = limiter(60)
  const uploadLimit = limiter(30)
  const exportLimit = limiter(30)
  const readLimit = limiter(180)
  const uploadJson = express.json({ limit: '15mb', strict: true, inflate: false })
  let documentRequests = 0
  const documentCapacity = (_req, res, next) => {
    // Reserve capacity before buffering a JSON upload or fetching document blobs.
    if (documentRequests >= 2) return res.status(503).json({ error: 'Document processing is busy. Please try again shortly.' })
    documentRequests += 1
    let released = false
    const release = () => { if (!released) { released = true; documentRequests -= 1 } }
    res.once('finish', release); res.once('close', release)
    next()
  }

  async function audit(connection, req, action, applicationId, metadata = {}) {
    await connection.execute('INSERT INTO audit_logs (id, user_id, action_type, description, metadata, ip_address) VALUES (?, ?, ?, ?, ?, ?)',
      [crypto.randomUUID(), req.user.sub, action, `${action}: ${applicationId}`, JSON.stringify({ applicationId, ...metadata }), text(req.ip, 64) || null])
  }
  async function find(connection, value, byId = false, lock = false) {
    // Lock only the application, not the joined account row. This avoids opposite
    // user/application lock order between student saves and adviser reviews.
    if (lock) await connection.execute(`SELECT id FROM applications WHERE ${byId ? 'id' : 'user_id'} = ? FOR UPDATE`, [value])
    const [rows] = await connection.execute(`${selectApplication} WHERE a.${byId ? 'id' : 'user_id'} = ? LIMIT 1`, [value])
    return rows[0] || null
  }
  async function findStudentApplication(connection, id, userId, lock = false) {
    if (lock) await connection.execute('SELECT id FROM applications WHERE id = ? AND user_id = ? FOR UPDATE', [id, userId])
    const [rows] = await connection.execute(`${selectApplication} WHERE a.id = ? AND a.user_id = ? LIMIT 1`, [id, userId])
    return rows[0] || null
  }
  async function assertUniversityAvailable(connection, userId, applicationId, university) {
    const normalize = value => String(value || '').normalize('NFKC').trim().replace(/\s+/g, ' ').toLocaleLowerCase('en-GB')
    const selected = normalize(university)
    if (!selected) return
    const [rows] = await connection.execute('SELECT id, data FROM applications WHERE user_id = ? AND id <> ? FOR UPDATE', [userId, applicationId])
    const duplicate = rows.some(row => normalize(object(row.data).university) === selected)
    if (duplicate) throw fail(409, 'You already have an application for this university. Continue that application or choose a different university.', 'UNIVERSITY_ALREADY_APPLIED')
  }
  async function snapshot(connection, row) {
    if (!row) return { id: null, data: null, requestedDocuments: [], documentSubmissions: {}, status: 'draft', version: 0, termsVersion: null, termsAcceptedAt: null }
    const [stored] = await connection.execute('SELECT document_key AS documentKey FROM application_document_files WHERE application_id = ?', [row.id])
    const available = new Set(stored.map((file) => file.documentKey))
    const submissions = cleanSubmissions(row.documentSubmissions, row.id)
    const data = sanitizeApplicationData(row.data)
    for (const key of DOCUMENT_KEYS) {
      delete data[key]
      if (submissions[key]?.fileName) data[key] = submissions[key].fileName
    }
    return {
      id: row.id, userId: row.userId, data, requestedDocuments: documentKeys(row.requestedDocuments),
      documentSubmissions: Object.fromEntries(Object.entries(submissions).map(([key, value]) => {
        const { storageName, ...metadata } = value
        return [key, { ...metadata, hasFile: available.has(key) || Boolean(storageName) }]
      })),
      status: row.status, version: Number(row.version), termsVersion: text(row.termsVersion, 40) || null,
      termsAcceptedAt: date(row.termsAcceptedAt), updatedAt: date(row.updatedAt), createdAt: date(row.createdAt),
      email: text(row.email), firstName: text(row.firstName, 100), lastName: text(row.lastName, 100),
    }
  }
  async function change(req, byId, operation, studentApplicationId = null) {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      if (!byId || studentApplicationId) {
        // Serialize creation too, where there is not yet an application row to lock.
        const [users] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.sub])
        if (!users[0]) throw fail(403, 'Your account is unavailable.')
      }
      const row = studentApplicationId
        ? await findStudentApplication(connection, studentApplicationId, req.user.sub, true)
        : await find(connection, byId ? req.params.id : req.user.sub, byId, true)
      if ((byId || studentApplicationId) && !row) throw fail(404, 'Application not found.')
      assertVersion(row, req.body?.version)
      const result = await operation(connection, row)
      await connection.commit()
      return result
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  }
  async function updated(connection, row) { return snapshot(connection, await find(connection, row.id, true)) }
  function writable(row) { if (!row) throw fail(404, 'Application not found.'); if (row.status === 'complete') throw fail(409, 'This application is locked. Ask your adviser to reopen it.') }

  app.get('/api/application', authenticate, readLimit, route(async (req, res) => res.json(await snapshot(pool, await find(pool, req.user.sub)))))
  app.get('/api/applications', authenticate, readLimit, route(async (req, res) => {
    const [rows] = await pool.execute(`${selectApplication} WHERE a.user_id = ? ORDER BY a.updated_at DESC, a.id DESC`, [req.user.sub])
    res.json({ applications: await Promise.all(rows.map(row => snapshot(pool, row))) })
  }))
  app.post('/api/applications', authenticate, writes, route(async (req, res) => {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [users] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.sub])
      if (!users[0]) throw fail(403, 'Your account is unavailable.')
      const [counts] = await connection.execute("SELECT SUM(status = 'draft') AS drafts, SUM(status <> 'draft') AS submitted FROM applications WHERE user_id = ?", [req.user.sub])
      if (Number(counts[0]?.drafts || 0) >= 10) throw fail(409, 'You can save up to 10 draft applications. Delete a saved application before creating another.')
      const id = crypto.randomUUID()
      await connection.execute("INSERT INTO applications (id, user_id, data, status, version) VALUES (?, ?, '{}', 'draft', 1)", [id, req.user.sub])
      await audit(connection, req, 'student_create_application', id)
      const created = await findStudentApplication(connection, id, req.user.sub)
      await connection.commit()
      res.status(201).json(await snapshot(pool, created))
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  }))
  app.get('/api/applications/:id', authenticate, readLimit, route(async (req, res) => {
    const row = await findStudentApplication(pool, req.params.id, req.user.sub)
    if (!row) throw fail(404, 'Application not found.')
    res.json(await snapshot(pool, row))
  }))
  app.put('/api/applications/:id', authenticate, writes, route(async (req, res) => {
    const requestedStatus = req.body?.status
    studentStatus(null, requestedStatus)
    const checked = validateApplicationData(req.body?.data, { submitted: requestedStatus === 'submitted' })
    if (checked.errors.length) throw fail(400, checked.errors.slice(0, 8).join(' '))
    if (requestedStatus === 'submitted' && req.body?.termsVersion !== TERMS_VERSION) throw fail(400, 'Read and accept the current Terms & Conditions before submitting.')
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [users] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.sub])
      if (!users[0]) throw fail(403, 'Your account is unavailable.')
      const row = await findStudentApplication(connection, req.params.id, req.user.sub, true)
      if (!row) throw fail(404, 'Application not found.')
      assertVersion(row, req.body?.version)
      await assertUniversityAvailable(connection, req.user.sub, row.id, checked.data.university)
      const status = studentStatus(row.status, requestedStatus)
      if (status !== 'draft') {
        const [counts] = await connection.execute("SELECT COUNT(*) AS total FROM applications WHERE user_id = ? AND status <> 'draft'", [req.user.sub])
        if (row.status === 'draft' && Number(counts[0]?.total || 0) >= 3) throw fail(409, 'You can submit up to 3 applications.')
        const current = validateApplicationData(checked.data, { submitted: true })
        if (current.errors.length) throw fail(400, current.errors.slice(0, 8).join(' '))
      }
      const data = { ...checked.data }
      const submissions = cleanSubmissions(row.documentSubmissions, row.id)
      for (const key of DOCUMENT_KEYS) { delete data[key]; if (submissions[key]?.fileName) data[key] = submissions[key].fileName }
      await connection.execute('UPDATE applications SET data = ?, status = ?, version = version + 1, terms_version = ?, terms_accepted_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
        [JSON.stringify(data), status, requestedStatus === 'submitted' ? TERMS_VERSION : row.termsVersion, requestedStatus === 'submitted' ? new Date() : row.termsAcceptedAt, row.id, req.user.sub])
      await audit(connection, req, requestedStatus === 'submitted' ? 'student_submit_application' : 'student_save_application', row.id, { status })
      const updatedRow = await findStudentApplication(connection, row.id, req.user.sub)
      await connection.commit()
      res.json({ saved: true, ...await snapshot(pool, updatedRow) })
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  }))
  app.delete('/api/applications/:id', authenticate, writes, route(async (req, res) => {
    const connection = await pool.getConnection()
    try {
      await connection.beginTransaction()
      const [users] = await connection.execute('SELECT id FROM users WHERE id = ? FOR UPDATE', [req.user.sub])
      if (!users[0]) throw fail(403, 'Your account is unavailable.')
      const row = await findStudentApplication(connection, req.params.id, req.user.sub, true)
      if (!row) throw fail(404, 'Application not found.')
      assertVersion(row, req.body?.version)
      if (row.status === 'complete') throw fail(409, 'This application is locked. Ask your adviser to reopen it.')
      await audit(connection, req, 'student_delete_application', row.id)
      await connection.execute('DELETE FROM applications WHERE id = ? AND user_id = ?', [row.id, req.user.sub])
      await connection.commit()
      try { await cleanupLegacyApplication(uploadsDir, row.id) } catch (error) { console.warn('Legacy application cleanup requires operator attention:', error.code || 'unknown') }
      res.status(204).end()
    } catch (error) { await connection.rollback(); throw error } finally { connection.release() }
  }))
  app.put('/api/application', authenticate, writes, route(async (req, res) => {
    const requestedStatus = req.body?.status
    // Do not accept staff-owned states even on record creation.
    studentStatus(null, requestedStatus)
    const submitted = requestedStatus === 'submitted'
    const checked = validateApplicationData(req.body?.data, { submitted })
    if (checked.errors.length) throw fail(400, checked.errors.slice(0, 8).join(' '))
    if (submitted && req.body?.termsVersion !== TERMS_VERSION) throw fail(400, 'Read and accept the current Terms & Conditions before submitting.')
    const result = await change(req, false, async (connection, row) => {
      const status = studentStatus(row?.status, requestedStatus)
      // Continue validating a submitted record even when the student clicks Save draft.
      if (status !== 'draft') {
        const current = validateApplicationData(checked.data, { submitted: true })
        if (current.errors.length) throw fail(400, current.errors.slice(0, 8).join(' '))
      }
      const data = { ...checked.data }
      const submissions = cleanSubmissions(row?.documentSubmissions, row?.id)
      for (const key of DOCUMENT_KEYS) { delete data[key]; if (submissions[key]?.fileName) data[key] = submissions[key].fileName }
      const id = row?.id || crypto.randomUUID()
      await assertUniversityAvailable(connection, req.user.sub, id, data.university)
      if (row) {
        await connection.execute('UPDATE applications SET data = ?, status = ?, version = version + 1, terms_version = ?, terms_accepted_at = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
          [JSON.stringify(data), status, submitted ? TERMS_VERSION : row.termsVersion, submitted ? new Date() : row.termsAcceptedAt, id])
      } else {
        await connection.execute('INSERT INTO applications (id, user_id, data, status, version, terms_version, terms_accepted_at) VALUES (?, ?, ?, ?, 1, ?, ?)',
          [id, req.user.sub, JSON.stringify(data), status, submitted ? TERMS_VERSION : null, submitted ? new Date() : null])
      }
      await audit(connection, req, submitted ? 'student_submit_application' : 'student_save_application', id, { status, termsVersion: submitted ? TERMS_VERSION : null })
      return snapshot(connection, await find(connection, id, true))
    })
    res.json({ saved: true, ...result })
  }))

  app.patch('/api/applications/:id/documents', authenticate, uploadLimit, documentCapacity, uploadJson, route(async (req, res) => {
    const incoming = req.body?.documents
    if (!isRecord(incoming) || !Object.keys(incoming).length || Object.keys(incoming).some((key) => !DOCUMENT_KEYS.includes(key))) throw fail(400, 'Select requested document files to upload.')
    const current = await findStudentApplication(pool, req.params.id, req.user.sub)
    writable(current); assertVersion(current, req.body?.version)
    function checkFiles(row) {
      const requested = documentKeys(row.requestedDocuments)
      const submissions = cleanSubmissions(row.documentSubmissions, row.id)
      for (const key of Object.keys(incoming)) {
        if (!requested.includes(key)) throw fail(400, 'This document has not been requested.')
        if (['accepted', 'submitted'].includes(submissions[key]?.status)) throw fail(409, 'This document is accepted or awaiting review. Ask your adviser before replacing it.')
      }
    }
    checkFiles(current)
    const decoded = Object.entries(incoming).map(([key, file]) => ({ key, ...decodeDocument(file) }))
    if (decoded.reduce((sum, file) => sum + file.content.length, 0) > MAX_DOCUMENT_BYTES) throw fail(413, 'Upload one file at a time, up to 10 MB per request.')
    const prepared = []
    for (const file of decoded) prepared.push({ key: file.key, ...await validate(file) })
    const result = await change(req, false, async (connection, row) => {
      writable(row); checkFiles(row)
      const submissions = cleanSubmissions(row.documentSubmissions, row.id)
      const data = sanitizeApplicationData(row.data)
      for (const file of prepared) {
        submissions[file.key] = { status: 'submitted', fileName: file.fileName, mimeType: file.mimeType, submittedAt: new Date().toISOString() }
        data[file.key] = file.fileName
        await connection.execute(`INSERT INTO application_document_files (application_id, document_key, file_name, mime_type, content, validation_status, scan_status)
          VALUES (?, ?, ?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE file_name = VALUES(file_name), mime_type = VALUES(mime_type), content = VALUES(content), validation_status = VALUES(validation_status), scan_status = VALUES(scan_status), updated_at = CURRENT_TIMESTAMP`,
          [row.id, file.key, file.fileName, file.mimeType, file.content, file.validationStatus, file.scanStatus])
      }
      await connection.execute('UPDATE applications SET data = ?, document_submissions = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(data), JSON.stringify(submissions), row.id])
      await audit(connection, req, 'student_upload_documents', row.id, { documents: prepared.map((file) => file.key) })
      return updated(connection, row)
    }, req.params.id)
    res.json({ sent: true, ...result })
  }))

  async function remove(req, byId) {
    const id = await change(req, byId, async (connection, row) => {
      if (!row) throw fail(404, 'Application not found.')
      if (!byId) writable(row)
      await audit(connection, req, byId ? 'advisor_delete_application' : 'student_delete_application', row.id)
      await connection.execute('DELETE FROM applications WHERE id = ?', [row.id])
      return row.id
    })
    // The authorisation/version checks and DB cascade have succeeded before local cleanup.
    try { await cleanupLegacyApplication(uploadsDir, id) } catch (error) { console.warn('Legacy application cleanup requires operator attention:', error.code || 'unknown') }
  }
  app.delete('/api/application', authenticate, writes, route(async (req, res) => { await remove(req, false); res.status(204).end() }))
  app.get('/api/advisor/applications', adviser('advisorDashboard'), readLimit, route(async (req, res) => {
    const page = Math.min(10000, Math.max(1, Number.parseInt(req.query.page, 10) || 1))
    const limit = Math.min(50, Math.max(1, Number.parseInt(req.query.limit, 10) || 25))
    const status = req.query.status
    if (status && !['draft', 'submitted', 'in_review', 'offer_received', 'complete'].includes(status)) throw fail(400, 'Invalid application status filter.')
    const where = status ? ' WHERE a.status = ?' : ''
    const parameters = status ? [status] : []
    const [count] = await pool.execute(`SELECT COUNT(*) AS total FROM applications a${where}`, parameters)
    // Extract scalar summary fields in SQL: lists never load document data or complete forms.
    const summaryFields = ['firstName', 'lastName', 'university', 'course', 'intake']
    const sqlText = (key) => `CASE WHEN JSON_TYPE(JSON_EXTRACT(a.data, '$.${key}')) = 'STRING' THEN JSON_UNQUOTE(JSON_EXTRACT(a.data, '$.${key}')) ELSE '' END`
    const progressSql = REQUIRED_APPLICATION_FIELDS.map((key) => `(CASE WHEN CHAR_LENGTH(TRIM(${sqlText(key)})) > 0 THEN 1 ELSE 0 END)`).join(' + ')
    const [rows] = await pool.query(`SELECT a.id, a.status, a.version, a.updated_at AS updatedAt,
      u.email, u.first_name AS firstName, u.last_name AS lastName,
      JSON_OBJECT(${summaryFields.map((key) => `'${key}', ${sqlText(key)}`).join(', ')}) AS summary,
      ROUND(100 * (${progressSql}) / ${REQUIRED_APPLICATION_FIELDS.length}) AS progress
      FROM applications a INNER JOIN users u ON u.id = a.user_id${where} ORDER BY a.updated_at DESC, a.id DESC LIMIT ? OFFSET ?`, [...parameters, limit, (page - 1) * limit])
    res.json({ applications: rows.map((row) => ({ id: row.id, status: row.status, version: Number(row.version), updatedAt: date(row.updatedAt), email: text(row.email), firstName: text(row.firstName, 100), lastName: text(row.lastName, 100), data: sanitizeApplicationData(row.summary), progress: Math.max(0, Math.min(100, Number(row.progress) || 0)) })), page, limit, total: Number(count[0]?.total || 0), hasMore: page * limit < Number(count[0]?.total || 0) })
  }))
  app.get('/api/advisor/applications/:id', adviser('advisorDashboard'), readLimit, route(async (req, res) => {
    const row = await find(pool, req.params.id, true)
    if (!row) throw fail(404, 'Application not found.')
    res.json({ ...await snapshot(pool, row), progress: applicationProgress(row.data) })
  }))
  app.patch('/api/advisor/applications/:id/status', adviser('advisorStatusUpdates'), writes, route(async (req, res) => {
    const status = req.body?.status
    if (!['in_review', 'complete'].includes(status)) throw fail(400, 'Invalid adviser status.')
    const result = await change(req, true, async (connection, row) => {
      const allowed = (status === 'in_review' && ['submitted', 'complete', 'offer_received'].includes(row.status)) || (status === 'complete' && row.status === 'in_review')
      if (!allowed) throw fail(409, 'This application cannot make that status transition.')
      await connection.execute('UPDATE applications SET status = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [status, row.id])
      await audit(connection, req, 'advisor_update_application_status', row.id, { status })
      return updated(connection, row)
    })
    res.json({ updated: true, ...result })
  }))
  app.patch('/api/advisor/applications/:id/documents', adviser('advisorDocuments'), writes, route(async (req, res) => {
    if (!Array.isArray(req.body?.documents) || req.body.documents.some((key) => !DOCUMENT_KEYS.includes(key))) throw fail(400, 'Choose valid document types.')
    const requested = [...new Set(req.body.documents)]
    const result = await change(req, true, async (connection, row) => {
      if (row.status !== 'in_review') throw fail(409, 'Start processing or reopen the application before requesting documents.')
      const submissions = cleanSubmissions(row.documentSubmissions, row.id)
      for (const key of requested) if (!submissions[key]) submissions[key] = { status: 'pending' }
      await connection.execute('UPDATE applications SET requested_documents = ?, document_submissions = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(requested), JSON.stringify(submissions), row.id])
      await audit(connection, req, 'advisor_request_documents', row.id, { documents: requested })
      return updated(connection, row)
    })
    res.json({ updated: true, ...result })
  }))
  app.patch('/api/advisor/applications/:id/documents/:key', adviser('advisorDocuments'), writes, route(async (req, res) => {
    const { key } = req.params
    if (!DOCUMENT_KEYS.includes(key) || !['accepted', 'rejected'].includes(req.body?.status)) throw fail(400, 'Invalid document review status.')
    const result = await change(req, true, async (connection, row) => {
      writable(row)
      if (!documentKeys(row.requestedDocuments).includes(key)) throw fail(404, 'Document was not requested.')
      const submissions = cleanSubmissions(row.documentSubmissions, row.id)
      if (!['submitted', 'accepted', 'rejected'].includes(submissions[key]?.status)) throw fail(409, 'The student has not submitted this document.')
      submissions[key] = { ...submissions[key], status: req.body.status, reviewedAt: new Date().toISOString() }
      await connection.execute('UPDATE applications SET document_submissions = ?, version = version + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?', [JSON.stringify(submissions), row.id])
      await audit(connection, req, 'advisor_review_document', row.id, { documentKey: key, status: req.body.status })
      return updated(connection, row)
    })
    res.json({ updated: true, ...result })
  }))

  async function storedDocument(row, key) {
    if (!documentKeys(row.requestedDocuments).includes(key)) throw fail(404, 'Document not found.')
    const submission = cleanSubmissions(row.documentSubmissions, row.id)[key]
    const [files] = await pool.execute('SELECT file_name AS fileName, mime_type AS mimeType, content FROM application_document_files WHERE application_id = ? AND document_key = ? LIMIT 1', [row.id, key])
    const file = files[0]
    const content = file?.content || (submission?.storageName && options.readLegacyUploadedFile ? await options.readLegacyUploadedFile(submission.storageName) : null)
    if (!content) throw fail(404, 'Document unavailable. Ask the student to upload it again.')
    // Validate historical blobs and legacy files on every read too; no old-file bypass.
    return validate({ content, fileName: file?.fileName || submission?.fileName || key, mimeType: file?.mimeType || submission?.mimeType })
  }
  app.get('/api/advisor/applications/:id/documents/:key/file', adviser('advisorDashboard'), exportLimit, documentCapacity, route(async (req, res) => {
    if (!DOCUMENT_KEYS.includes(req.params.key)) throw fail(404, 'Document not found.')
    const row = await find(pool, req.params.id, true)
    if (!row) throw fail(404, 'Application not found.')
    const file = await storedDocument(row, req.params.key)
    await audit(pool, req, req.query.download === '1' ? 'advisor_download_document' : 'advisor_view_document', row.id, { documentKey: req.params.key })
    res.setHeader('Content-Type', file.mimeType)
    res.setHeader('Content-Disposition', `attachment; filename="${file.fileName}"`)
    res.send(file.content)
  }))
  app.get('/api/advisor/applications/:id/pdf', adviser('advisorDashboard'), exportLimit, documentCapacity, route(async (req, res) => {
    const row = await find(pool, req.params.id, true)
    if (!row) throw fail(404, 'Application not found.')
    if (!options.buildApplicationPdf) throw fail(503, 'PDF generation is unavailable.')
    const record = await snapshot(pool, row)
    record.documentFiles = {}
    let bytes = 0; let pages = 0
    for (const key of record.requestedDocuments) {
      if (!record.documentSubmissions[key]?.hasFile) continue
      const file = await storedDocument(row, key)
      bytes += file.content.length; pages += file.pages
      if (bytes > 30 * 1024 * 1024 || pages > 200) throw fail(413, 'The combined PDF is too large. Download the documents separately.')
      record.documentFiles[key] = file
      // The existing PDF renderer expects a presence marker; it never reads this virtual name.
      record.documentSubmissions[key].storageName = `${row.id}/${file.fileName}`
    }
    const pdf = await options.buildApplicationPdf(record)
    await audit(pool, req, 'advisor_download_application_pdf', row.id)
    res.setHeader('Content-Type', 'application/pdf')
    res.setHeader('Content-Disposition', 'attachment; filename="student-application.pdf"')
    res.send(Buffer.from(pdf))
  }))
  app.delete('/api/advisor/applications/:id', adviser('advisorDeleteApplications'), writes, route(async (req, res) => { await remove(req, true); res.status(204).end() }))
}

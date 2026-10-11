import crypto from 'node:crypto'
import { mkdir, rename, unlink } from 'node:fs/promises'
import path from 'node:path'
import express from 'express'
import multer from 'multer'
import sharp from 'sharp'
import { staffRequired } from './security.js'

const CONTENT_KEY = /^ui\.[a-z0-9.-]+$/
const CONTENT_FIELD = /^[a-zA-Z0-9._-]{1,120}$/
const IMAGE_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp', 'image/avif'])
const MAX_CONTENT_BYTES = 128 * 1024
const MAX_CONTENT_FIELDS = 1000
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const MAX_IMAGE_PIXELS = 25_000_000
const reservedFields = new Set(['__proto__', 'prototype', 'constructor'])

const object = value => {
  if (value && typeof value === 'object' && !Array.isArray(value)) return value
  try { const parsed = JSON.parse(value); return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {} } catch { return {} }
}
const handler = fn => (req, res, next) => Promise.resolve(fn(req, res)).catch(next)
const validField = value => typeof value === 'string' && CONTENT_FIELD.test(value) && !reservedFields.has(value)
const safeContent = value => Object.fromEntries(Object.entries(object(value)).filter(([key, item]) => validField(key) && typeof item === 'string' && item.length <= 5000))

export function validateContentKey(value) {
  return typeof value === 'string' && value.length <= 120 && CONTENT_KEY.test(value)
}

export function validateContentValue(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  if (Object.keys(value).length > MAX_CONTENT_FIELDS) return false
  if (Buffer.byteLength(JSON.stringify(value)) > MAX_CONTENT_BYTES) return false
  return Object.entries(value).every(([key, item]) => validField(key) && typeof item === 'string' && item.length <= 5000)
}

async function saveContentField(pool, key, field, fieldValue, userId) {
  const connection = await pool.getConnection()
  try {
    await connection.beginTransaction()
    // The primary key makes this insert lock existing and first-time pages alike.
    // Hold that row lock while validating the merged size and saving the field.
    await connection.execute('INSERT INTO site_content (content_key, content_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE content_key = VALUES(content_key)', [key, '{}', userId])
    const [rows] = await connection.execute('SELECT content_value AS contentValue FROM site_content WHERE content_key = ? FOR UPDATE', [key])
    const value = safeContent(rows[0]?.contentValue)
    const previous = value[field]
    if (fieldValue === null) delete value[field]
    else value[field] = fieldValue
    if (!validateContentValue(value)) throw Object.assign(new Error('This page can contain at most 128 KB of text and 1,000 editable fields.'), { status: 400 })
    await connection.execute('UPDATE site_content SET content_value = ?, updated_by = ? WHERE content_key = ?', [JSON.stringify(value), userId, key])
    await connection.commit()
    return { value, previous }
  } catch (error) {
    await connection.rollback()
    throw error
  } finally {
    connection.release()
  }
}

function imageUpload() {
  const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_BYTES, files: 1, fields: 2 },
    fileFilter: (_req, file, done) => done(IMAGE_TYPES.has(file.mimetype) ? null : Object.assign(new Error('Choose a JPEG, PNG, WebP or AVIF image.'), { status: 400 }), IMAGE_TYPES.has(file.mimetype)),
  }).single('image')
  return (req, res, next) => upload(req, res, error => {
    if (!error) return next()
    if (error.code === 'LIMIT_FILE_SIZE') error.status = 413
    else if (!error.status) error.status = 400
    next(error)
  })
}

export function registerContentRoutes(app, { pool, uploadsDir, logAuditAction }) {
  const mediaDir = path.resolve(uploadsDir, 'site-content')
  const upload = imageUpload()
  const log = (req, actionType, description, metadata) => logAuditAction({ userId: req.user.sub, actionType, description, metadata, ipAddress: req.ip })

  app.use('/content-images', express.static(mediaDir, {
    dotfiles: 'deny', index: false, fallthrough: false, maxAge: '1y', immutable: true,
    setHeaders(res) { res.set('X-Content-Type-Options', 'nosniff') },
  }))

  app.get('/api/content/:key', handler(async (req, res) => {
    const key = req.params.key
    if (!validateContentKey(key)) return res.status(400).json({ error: 'Invalid content key.' })
    const [rows] = await pool.execute('SELECT content_value AS contentValue, updated_at AS updatedAt FROM site_content WHERE content_key = ? LIMIT 1', [key])
    res.json({ contentKey: key, value: safeContent(rows[0]?.contentValue), updatedAt: rows[0]?.updatedAt || null })
  }))

  app.get('/api/admin/content', staffRequired('viewOnly'), handler(async (_req, res) => {
    const [rows] = await pool.query("SELECT content_key AS contentKey, content_value AS contentValue, updated_by AS updatedBy, updated_at AS updatedAt FROM site_content WHERE content_key LIKE 'ui.%' ORDER BY content_key LIMIT 100")
    res.json({ content: rows.map(row => ({ ...row, contentValue: safeContent(row.contentValue) })) })
  }))

  app.put('/api/admin/content/:key', staffRequired('manageContent'), handler(async (req, res) => {
    const key = req.params.key
    const value = req.body?.value
    if (!validateContentKey(key) || !validateContentValue(value)) return res.status(400).json({ error: 'Enter valid text content of at most 128 KB and 1,000 fields.' })
    await pool.execute('INSERT INTO site_content (content_key, content_value, updated_by) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE content_value = VALUES(content_value), updated_by = VALUES(updated_by)', [key, JSON.stringify(value), req.user.sub])
    await log(req, 'manage_content', 'Updated website text content', { contentKey: key })
    res.json({ updated: true, contentKey: key, value })
  }))

  app.patch('/api/admin/content/:key/field', staffRequired('manageContent'), handler(async (req, res) => {
    const key = req.params.key
    const { field, value: fieldValue } = req.body || {}
    if (!validateContentKey(key) || !validField(field) || !(fieldValue === null || (typeof fieldValue === 'string' && fieldValue.length <= 5000))) {
      return res.status(400).json({ error: 'Choose a valid field and enter plain text of at most 5,000 characters, or reset it.' })
    }
    const { value } = await saveContentField(pool, key, field, fieldValue, req.user.sub)
    await log(req, 'manage_content', fieldValue === null ? 'Restored a website content field' : 'Updated a website content field', { contentKey: key, field })
    res.json({ updated: true, contentKey: key, field, fieldValue, value })
  }))

  app.post('/api/admin/content/:key/image', staffRequired('manageContent'), upload, handler(async (req, res) => {
    const key = req.params.key
    const field = String(req.body?.field || '')
    if (!validateContentKey(key) || !validField(field)) return res.status(400).json({ error: 'Invalid image location.' })
    if (!req.file) return res.status(400).json({ error: 'Choose an image to upload.' })

    const source = sharp(req.file.buffer, { failOn: 'error', limitInputPixels: MAX_IMAGE_PIXELS })
    const metadata = await source.metadata()
    if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_IMAGE_PIXELS) return res.status(400).json({ error: 'The image dimensions are too large.' })

    await mkdir(mediaDir, { recursive: true, mode: 0o750 })
    const filename = `${Date.now()}-${crypto.randomUUID()}.webp`
    const temporary = path.join(mediaDir, `.${filename}.tmp`)
    const destination = path.join(mediaDir, filename)
    try {
      await source.rotate().resize({ width: 2400, height: 1800, fit: 'inside', withoutEnlargement: true }).webp({ quality: 84, effort: 5 }).toFile(temporary)
      await rename(temporary, destination)
    } catch (error) {
      await unlink(temporary).catch(() => {})
      error.status = 400
      throw error
    }

    const url = `/content-images/${filename}`
    let value, previous
    try {
      const saved = await saveContentField(pool, key, field, url, req.user.sub)
      value = saved.value
      previous = saved.previous
    } catch (error) {
      await unlink(destination).catch(() => {})
      throw error
    }
    if (typeof previous === 'string' && /^\/content-images\/[0-9]+-[a-f0-9-]+\.webp$/.test(previous)) await unlink(path.join(mediaDir, path.basename(previous))).catch(() => {})
    await log(req, 'manage_content_image', 'Replaced a website image', { contentKey: key, field })
    res.status(201).json({ updated: true, contentKey: key, field, url, value })
  }))
}

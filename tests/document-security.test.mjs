import test from 'node:test'
import assert from 'node:assert/strict'
import { PDFDocument } from 'pdf-lib'
import sharp from 'sharp'
import { decodeDocument, safeDocumentName, scanDocument, validateDocument } from '../server/document-validation.js'

const withoutScanner = { environment: {} }
test('filenames cannot smuggle executable extensions or header delimiters', () => {
  assert.equal(safeDocumentName('../../fake.exe', 'application/pdf'), 'fake.pdf')
  assert.equal(safeDocumentName('C:\\path\\fake.exe', 'image/png'), 'fake.png')
  assert.ok(!safeDocumentName('bad\r\nname.pdf', 'application/pdf').includes('\n'))
  assert.throws(() => decodeDocument({ content: '%%%%', fileName: 'x.pdf', mimeType: 'application/pdf' }), { status: 400 })
  assert.throws(() => decodeDocument({ content: 'aA==', fileName: 'x.html', mimeType: 'text/html' }), { status: 400 })
})

test('actual worker rejects MIME spoofing instead of trusting a client PDF/PNG label', async () => {
  for (const mimeType of ['application/pdf', 'image/png', 'image/jpeg']) {
    await assert.rejects(validateDocument({ content: Buffer.from('benign non-document'), fileName: 'bad.pdf', mimeType }, withoutScanner), { status: 422 })
  }
})

test('actual worker normalizes ordinary PDF and rejects PDF JavaScript and excessive pages', async () => {
  const doc = await PDFDocument.create(); doc.addPage()
  const clean = await validateDocument({ content: Buffer.from(await doc.save()), fileName: 'application.exe', mimeType: 'application/pdf' }, withoutScanner)
  assert.equal(clean.fileName, 'application.pdf'); assert.equal(clean.pages, 1); assert.equal(clean.scanStatus, 'not_scanned')
  assert.equal((await PDFDocument.load(clean.content)).getPageCount(), 1)
  doc.addJavaScript('unsafe', 'app.alert("synthetic test")')
  await assert.rejects(validateDocument({ content: Buffer.from(await doc.save()), fileName: 'active.pdf', mimeType: 'application/pdf' }, withoutScanner), /active content|actions|attachments/)
  const large = await PDFDocument.create(); for (let i = 0; i < 101; i++) large.addPage()
  await assert.rejects(validateDocument({ content: Buffer.from(await large.save()), fileName: 'long.pdf', mimeType: 'application/pdf' }, withoutScanner), /100 pages/)
})

test('actual image decoder re-encodes PNG/JPEG and removes trailing payload data', async () => {
  for (const mimeType of ['image/png', 'image/jpeg']) {
    const generator = sharp({ create: { width: 3, height: 3, channels: 3, background: '#ffffff' } })
    const content = await (mimeType === 'image/png' ? generator.png() : generator.jpeg()).toBuffer()
    const withTrailer = Buffer.concat([content, Buffer.from('synthetic-trailing-payload')])
    const result = await validateDocument({ content: withTrailer, fileName: 'image.exe', mimeType }, withoutScanner)
    assert.equal(result.content.includes(Buffer.from('synthetic-trailing-payload')), false)
    assert.equal((await sharp(result.content).metadata()).width, 3)
    assert.ok(result.fileName.endsWith(mimeType === 'image/png' ? '.png' : '.jpg'))
  }
})

test('worker timeout is bounded and required malware scanning fails closed when unconfigured', async () => {
  const doc = await PDFDocument.create(); doc.addPage()
  await assert.rejects(validateDocument({ content: Buffer.from(await doc.save()), mimeType: 'application/pdf', fileName: 'x.pdf' }, { environment: {}, timeoutMs: 1 }), /time limit/)
  await assert.rejects(scanDocument(Buffer.from('synthetic'), { DOCUMENT_REQUIRE_MALWARE_SCAN: 'true' }), { status: 503 })
  await assert.rejects(scanDocument(Buffer.from('synthetic'), { DOCUMENT_CLAMAV_SOCKET: 'relative-path' }), { status: 503 })
})

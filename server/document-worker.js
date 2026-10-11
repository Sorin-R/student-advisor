import { parentPort, workerData } from 'node:worker_threads'
import { PDFDocument, PDFDict, PDFArray, PDFRawStream, PDFName, PDFNumber } from 'pdf-lib'

const MAX_PIXELS = 16_000_000
const MAX_PAGES = 100
const MAX_BYTES = 10 * 1024 * 1024
const forbiddenKeys = new Set(['A', 'AA', 'OpenAction', 'JS', 'JavaScript', 'EmbeddedFiles', 'EF', 'RichMedia', 'XFA', 'AcroForm', 'Launch', 'SubmitForm', 'ImportData', 'GoToR', 'Collection'])
const forbiddenNames = new Set(['JavaScript', 'Launch', 'SubmitForm', 'ImportData', 'GoToR', 'GoToE', 'EmbeddedFile', 'Filespec', 'RichMedia', 'Movie', 'Sound', '3D'])

function inspectPdfObject(object, depth = 0, budget = { remaining: 200_000 }, context) {
  if (--budget.remaining < 0 || depth > 40) throw new Error('PDF structure is too complex.')
  if (object instanceof PDFName && forbiddenNames.has(object.decodeText())) throw new Error('PDF contains active content or attachments. Export a flattened PDF and try again.')
  if (object instanceof PDFRawStream) return inspectPdfObject(object.dict, depth + 1, budget, context)
  if (object instanceof PDFArray) for (const value of object.asArray()) inspectPdfObject(value, depth + 1, budget, context)
  if (object instanceof PDFDict) {
    for (const [name, value] of object.entries()) {
      if (forbiddenKeys.has(name.decodeText())) throw new Error('PDF contains forms, actions or attachments. Export a flattened PDF and try again.')
      inspectPdfObject(value, depth + 1, budget, context)
    }
    const width = context.lookup(object.get(PDFName.of('Width')))
    const height = context.lookup(object.get(PDFName.of('Height')))
    if (width instanceof PDFNumber && height instanceof PDFNumber && (width.asNumber() <= 0 || height.asNumber() <= 0 || width.asNumber() * height.asNumber() > MAX_PIXELS)) throw new Error('A PDF image exceeds the 16 megapixel limit.')
    // External stream files are not self-contained documents.
    if (object.get(PDFName.of('F')) && object.get(PDFName.of('Length'))) throw new Error('PDF external streams are not allowed.')
  }
}

async function validate() {
  const content = Buffer.from(workerData.content)
  if (!content.length || content.length > MAX_BYTES) throw new Error('Each document must be 10 MB or smaller.')
  const declared = workerData.mimeType
  if (declared === 'application/pdf') {
    if (!content.subarray(0, 8).toString('ascii').match(/^%PDF-1\.[0-9]|^%PDF-2\.0/)) throw new Error('The file does not contain a PDF document.')
    const document = await PDFDocument.load(content, { ignoreEncryption: false, updateMetadata: false, throwOnInvalidObject: true, parseSpeed: 100 })
    if (document.isEncrypted) throw new Error('Password-protected documents are not supported.')
    const pages = document.getPages()
    if (!pages.length || pages.length > MAX_PAGES) throw new Error('A PDF must have between 1 and 100 pages.')
    const objects = document.context.enumerateIndirectObjects()
    if (objects.length > 50_000) throw new Error('PDF has too many objects.')
    const budget = { remaining: 200_000 }
    for (const [, object] of objects) inspectPdfObject(object, 0, budget, document.context)
    for (const page of pages) {
      const { width, height } = page.getSize()
      if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0 || width > 20_000 || height > 20_000) throw new Error('PDF page dimensions are too large.')
      page.node.delete(PDFName.of('Annots'))
    }
    // Rebuild the catalog from approved pages; omit attachments, document metadata and actions.
    const clean = await PDFDocument.create()
    for (const page of await clean.copyPages(document, document.getPageIndices())) clean.addPage(page)
    const output = await clean.save({ useObjectStreams: true })
    if (output.length > MAX_BYTES) throw new Error('The normalized document exceeds 10 MB.')
    return { content: output, mimeType: declared, pages: pages.length }
  }
  const png = content.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
  const jpeg = content[0] === 0xff && content[1] === 0xd8 && content[2] === 0xff
  if ((declared === 'image/png' && !png) || (declared === 'image/jpeg' && !jpeg) || !['image/png', 'image/jpeg'].includes(declared)) throw new Error('The file content does not match its image type.')
  const { default: sharp } = await import('sharp')
  sharp.cache(false)
  sharp.concurrency(1)
  const input = sharp(content, { failOn: 'warning', limitInputPixels: MAX_PIXELS, animated: false })
  const metadata = await input.metadata()
  if (!metadata.width || !metadata.height || metadata.width * metadata.height > MAX_PIXELS || (metadata.pages || 1) !== 1 || !['png', 'jpeg'].includes(metadata.format)) throw new Error('Use a single image no larger than 16 megapixels.')
  // Decoding and re-encoding strips trailing payloads, EXIF and other metadata.
  const output = await (declared === 'image/png' ? input.rotate().png() : input.rotate().jpeg({ quality: 90 })).toBuffer()
  if (output.length > MAX_BYTES) throw new Error('The normalized image exceeds 10 MB.')
  return { content: output, mimeType: declared, pages: 1 }
}

validate().then((result) => parentPort.postMessage({ ok: true, ...result })).catch((error) => {
  parentPort.postMessage({ ok: false, error: String(error.message || 'The document could not be validated.').slice(0, 240) })
})

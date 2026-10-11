import path from 'node:path'
import net from 'node:net'
import { Worker } from 'node:worker_threads'

export const MAX_DOCUMENT_BYTES = 10 * 1024 * 1024
let activeWorkers = 0
const failure = (message, status = 422) => Object.assign(new Error(message), { status })

export function safeDocumentName(value, mimeType) {
  const extension = { 'application/pdf': '.pdf', 'image/jpeg': '.jpg', 'image/png': '.png' }[mimeType]
  if (!extension) throw failure('Documents must be PDF, JPG or PNG files.')
  const original = typeof value === 'string' ? value : ''
  const basename = path.basename(original.replaceAll('\\', '/'))
  const stem = basename.replace(/\.[^.]*$/, '').normalize('NFKD').replace(/[^a-zA-Z0-9 _-]/g, '_').replace(/^[ .]+|[ .]+$/g, '').slice(0, 150) || 'document'
  return stem + extension
}

export function decodeDocument(file) {
  if (!file || typeof file !== 'object' || Array.isArray(file) || typeof file.content !== 'string' || typeof file.fileName !== 'string' || !file.fileName.trim() || file.fileName.length > 255) throw failure('A filename and base64 file content are required.', 400)
  if (!['application/pdf', 'image/jpeg', 'image/png'].includes(file.mimeType)) throw failure('Documents must be PDF, JPG or PNG files.', 400)
  if (file.content.length > Math.ceil(MAX_DOCUMENT_BYTES / 3) * 4) throw failure('The document exceeds 10 MB.', 413)
  if (file.content.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(file.content)) throw failure('Invalid base64 document.', 400)
  const content = Buffer.from(file.content, 'base64')
  if (!content.length || content.length > MAX_DOCUMENT_BYTES) throw failure('Each document must be 10 MB or smaller.', 413)
  if (content.toString('base64') !== file.content) throw failure('Invalid base64 document.', 400)
  return { content, mimeType: file.mimeType, fileName: safeDocumentName(file.fileName, file.mimeType) }
}

// Optional local ClamAV daemon. Configuration errors and scanner failures fail closed.
// Structural validation is not represented as an antivirus scan when no scanner is configured.
export async function scanDocument(content, environment = process.env) {
  const socketPath = environment.DOCUMENT_CLAMAV_SOCKET
  if (!socketPath) {
    if (environment.DOCUMENT_REQUIRE_MALWARE_SCAN === 'true') throw failure('Document scanning is not configured. Contact support.', 503)
    return 'not_scanned'
  }
  if (!path.isAbsolute(socketPath)) throw failure('Document scanner configuration is invalid.', 503)
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath })
    let response = ''
    let finished = false
    const finish = (error, result) => { if (finished) return; finished = true; socket.destroy(); error ? reject(error) : resolve(result) }
    socket.setTimeout(15_000, () => finish(failure('Document scanner timed out. Try again later.', 503)))
    socket.on('error', () => finish(failure('Document scanning is temporarily unavailable.', 503)))
    socket.on('connect', () => {
      socket.write('zINSTREAM\0')
      for (let offset = 0; offset < content.length; offset += 64 * 1024) {
        const chunk = content.subarray(offset, offset + 64 * 1024)
        const length = Buffer.alloc(4); length.writeUInt32BE(chunk.length)
        socket.write(length); socket.write(chunk)
      }
      socket.write(Buffer.alloc(4))
    })
    socket.on('data', (chunk) => {
      response += chunk.toString('utf8')
      if (response.length > 4096) return finish(failure('Invalid document scanner response.', 503))
      if (!response.includes('\0') && !response.includes('\n')) return
      if (/^stream: OK[\0\n]/.test(response)) finish(null, 'clean')
      else if (/ FOUND[\0\n]/.test(response)) finish(failure('The document was rejected by the malware scanner.'))
      else finish(failure('The document scanner could not validate this file.', 503))
    })
    socket.on('end', () => { if (!finished) finish(failure('Incomplete document scanner response.', 503)) })
  })
}

export async function validateDocument(file, options = {}) {
  if (!Buffer.isBuffer(file.content) && !(file.content instanceof Uint8Array)) throw failure('Document bytes are required.', 400)
  if (!file.content.length || file.content.length > MAX_DOCUMENT_BYTES) throw failure('Each document must be 10 MB or smaller.', 413)
  if (activeWorkers >= 2) throw failure('Document processing is busy. Please try again shortly.', 503)
  activeWorkers += 1
  try {
    const scanStatus = await scanDocument(file.content, options.environment || process.env)
    const result = await new Promise((resolve, reject) => {
      const worker = new Worker(new URL('./document-worker.js', import.meta.url), {
        workerData: { content: file.content, mimeType: file.mimeType },
        resourceLimits: { maxOldGenerationSizeMb: 128, maxYoungGenerationSizeMb: 16, stackSizeMb: 4 },
      })
      let finished = false
      const finish = (error, value) => {
        if (finished) return
        finished = true; clearTimeout(timer); void worker.terminate()
        error ? reject(error) : resolve(value)
      }
      const timer = setTimeout(() => finish(failure('Document processing exceeded its time limit. Use a simpler file.')), options.timeoutMs || 8000)
      worker.on('message', (message) => message.ok ? finish(null, message) : finish(failure(message.error)))
      worker.on('error', () => finish(failure('The document could not be processed within the resource limit.')))
      worker.on('exit', () => { if (!finished) finish(failure('Document processing stopped unexpectedly.')) })
    })
    return { content: Buffer.from(result.content), fileName: safeDocumentName(file.fileName, result.mimeType), mimeType: result.mimeType, pages: result.pages, scanStatus, validationStatus: 'validated' }
  } finally { activeWorkers -= 1 }
}

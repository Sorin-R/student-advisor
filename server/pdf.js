import { Worker } from 'node:worker_threads'

let active = 0
export function buildApplicationPdf(row) {
  if (active >= 2) return Promise.reject(Object.assign(new Error('PDF generation is busy. Please try again shortly.'), { status: 503 }))
  const bytes = Object.values(row.documentFiles || {}).reduce((sum, item) => sum + (item.content?.byteLength || 0), 0)
  if (bytes > 30 * 1024 * 1024) return Promise.reject(Object.assign(new Error('Download these documents individually; this combined PDF is too large.'), { status: 413 }))
  active++
  return new Promise((resolve, reject) => {
    let settled = false
    let worker
    let timer
    const finish = (error, result) => {
      if (settled) return
      settled = true
      active--
      clearTimeout(timer)
      worker?.terminate().catch(() => {})
      if (error) reject(error); else resolve(result)
    }
    try {
      worker = new Worker(new URL('./pdf-worker.js', import.meta.url), { workerData: row, resourceLimits: { maxOldGenerationSizeMb: 192, maxYoungGenerationSizeMb: 32 } })
      timer = setTimeout(() => finish(Object.assign(new Error('PDF generation timed out. Download documents separately.'), { status: 422 })), 20_000)
      worker.once('message', (result) => finish(result.error ? Object.assign(new Error(result.error), { status: 422 }) : null, result.bytes && Buffer.from(result.bytes)))
      worker.once('error', () => finish(Object.assign(new Error('PDF generation failed. Download documents separately.'), { status: 422 })))
      worker.once('exit', (code) => { if (!settled) finish(Object.assign(new Error(`PDF worker ended before completion (${code}).`), { status: 422 })) })
    } catch (error) { finish(error) }
  })
}

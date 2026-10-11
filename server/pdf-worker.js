import { parentPort, workerData } from 'node:worker_threads'
import { buildApplicationPdf } from './pdf-render.js'

try {
  const bytes = await buildApplicationPdf(workerData)
  parentPort.postMessage({ bytes })
} catch {
  parentPort.postMessage({ error: 'The application PDF could not be created.' })
}

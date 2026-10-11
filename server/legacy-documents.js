import path from 'node:path'
import { readFile, realpath } from 'node:fs/promises'

export function createLegacyReader(uploadsDir) {
  return async (storageName) => {
    if (typeof storageName !== 'string' || !/^[a-f\d-]{36}\/[a-zA-Z0-9._-]+$/.test(storageName)) return null
    try {
      const root = await realpath(uploadsDir)
      const filename = await realpath(path.resolve(root, storageName))
      if (!filename.startsWith(root + path.sep)) return null
      return await readFile(filename)
    } catch (error) { if (error.code === 'ENOENT') return null; throw error }
  }
}

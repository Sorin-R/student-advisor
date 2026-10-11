import { readFile } from 'node:fs/promises'

export async function loadPrivacyNotice(filename) {
  if (!filename) return null
  try {
    const notice = JSON.parse(await readFile(filename, 'utf8'))
    if (notice.approved !== true || !/^\d{4}-\d{2}-\d{2}$/.test(notice.updated || '')) return null
    if (!notice.controller?.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(notice.contactEmail || '')) return null
    if (!Array.isArray(notice.sections) || notice.sections.length < 5) return null
    const sections = notice.sections.map(({ title, body }) => ({ title, body }))
    if (sections.some(({ title, body }) => typeof title !== 'string' || typeof body !== 'string' || !title.trim() || body.trim().length < 20 || /\[TO COMPLETE\]|REPLACE_ME/i.test(title + body))) return null
    return { controller: notice.controller, contactEmail: notice.contactEmail, updated: notice.updated, sections }
  } catch { return null }
}

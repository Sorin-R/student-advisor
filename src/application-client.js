// Only File objects selected in this visit can become an upload request.
// Existing server filenames are metadata and never treated as local File objects.
export function selectedDocumentUploads(files, requested, submissions) {
  return Object.entries(files).filter(([key, file]) => requested.includes(key)
    && !['accepted', 'submitted'].includes(submissions[key]?.status)
    && file && typeof file.name === 'string' && typeof file.size === 'number')
}

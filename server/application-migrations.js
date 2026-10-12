// Additive only. Existing documents and application JSON are never rewritten here.
// Run explicitly during deployment with the migration account, before serving traffic.
export async function migrateApplications(pool) {
  const statements = [
    'ALTER TABLE applications ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1',
    'ALTER TABLE applications ADD COLUMN terms_version VARCHAR(40) NULL',
    'ALTER TABLE applications ADD COLUMN terms_accepted_at DATETIME NULL',
    'ALTER TABLE application_document_files ADD COLUMN validation_status VARCHAR(30) NOT NULL DEFAULT \'legacy\'',
    'ALTER TABLE application_document_files ADD COLUMN scan_status VARCHAR(30) NOT NULL DEFAULT \'not_scanned\'',
  ]
  for (const sql of statements) {
    try { await pool.execute(sql) } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
  }
  // Earlier releases allowed one application per account. Remove that unique
  // index so the account can keep separate drafts and submissions.
  const [indexes] = await pool.execute(`SELECT INDEX_NAME AS name, NON_UNIQUE AS nonUnique,
      SEQ_IN_INDEX AS sequenceInIndex, COLUMN_NAME AS columnName
    FROM INFORMATION_SCHEMA.STATISTICS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'applications'`)
  const supportingIndexExists = indexes.some(index => Number(index.nonUnique) === 1 && Number(index.sequenceInIndex) === 1 && index.columnName === 'user_id')
  const uniqueUserIndexes = [...new Set(indexes
    .filter(index => Number(index.nonUnique) === 0 && index.name !== 'PRIMARY' && index.columnName === 'user_id')
    .map(index => String(index.name)))]
  // InnoDB may be using the unique user_id index to support the FK. Add a
  // regular replacement index first, or MySQL refuses to drop the unique one.
  if (uniqueUserIndexes.length && !supportingIndexExists) {
    await pool.execute('ALTER TABLE applications ADD INDEX applications_user_id_idx (user_id)')
  }
  for (const name of uniqueUserIndexes) await pool.execute(`ALTER TABLE applications DROP INDEX \`${name.replace(/`/g, '')}\``)
}

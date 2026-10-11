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
}

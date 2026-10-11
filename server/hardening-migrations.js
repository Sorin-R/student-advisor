export const HARDENING_SCHEMA_VERSION = 1
export async function migrateHardening(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS request_limits (
    bucket_key CHAR(64) PRIMARY KEY, hits INT UNSIGNED NOT NULL,
    expires_at DATETIME NOT NULL, INDEX request_limit_expiry (expires_at)
  ) ENGINE=InnoDB`)
  const [rules] = await pool.execute("SELECT DELETE_RULE FROM information_schema.REFERENTIAL_CONSTRAINTS WHERE CONSTRAINT_SCHEMA = DATABASE() AND TABLE_NAME = 'audit_logs' AND CONSTRAINT_NAME = 'audit_user_fk'")
  if (rules[0]?.DELETE_RULE !== 'SET NULL') {
    if (rules.length) await pool.query('ALTER TABLE audit_logs DROP FOREIGN KEY audit_user_fk')
    await pool.query('ALTER TABLE audit_logs MODIFY user_id CHAR(36) NULL')
    await pool.query('ALTER TABLE audit_logs ADD CONSTRAINT audit_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL')
  }
  await pool.query('CREATE TABLE IF NOT EXISTS security_schema_versions (component VARCHAR(80) PRIMARY KEY, version INT NOT NULL) ENGINE=InnoDB')
  await pool.execute('INSERT INTO security_schema_versions (component, version) VALUES (?, ?) ON DUPLICATE KEY UPDATE version = VALUES(version)', ['hardening', HARDENING_SCHEMA_VERSION])
}
export async function assertHardeningSchema(pool) {
  const [rows] = await pool.execute('SELECT version FROM security_schema_versions WHERE component = ?', ['hardening'])
  if (Number(rows[0]?.version) !== HARDENING_SCHEMA_VERSION) throw new Error('Schema migration required. Run npm run db:migrate with the migration account.')
  await pool.query('SELECT version, terms_version, terms_accepted_at FROM applications LIMIT 0')
  await pool.query('SELECT validation_status, scan_status FROM application_document_files LIMIT 0')
  await pool.query('SELECT content_key, content_value, updated_by, updated_at FROM site_content LIMIT 0')
}

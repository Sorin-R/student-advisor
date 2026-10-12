export const ANALYTICS_SCHEMA_VERSION = 1

export async function migrateAnalytics(pool) {
  await pool.query(`CREATE TABLE IF NOT EXISTS analytics_events (
    id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
    visitor_id CHAR(36) NOT NULL,
    session_id CHAR(36) NOT NULL,
    event_type VARCHAR(32) NOT NULL,
    page_path VARCHAR(180) NOT NULL,
    target VARCHAR(120) NULL,
    section_id VARCHAR(120) NULL,
    duration_seconds SMALLINT UNSIGNED NULL,
    occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX analytics_occurred_idx (occurred_at),
    INDEX analytics_type_date_idx (event_type, occurred_at),
    INDEX analytics_page_date_idx (page_path, occurred_at),
    INDEX analytics_visitor_date_idx (visitor_id, occurred_at),
    INDEX analytics_session_idx (session_id, occurred_at),
    INDEX analytics_target_idx (target, event_type, occurred_at),
    INDEX analytics_section_idx (section_id, event_type, occurred_at)
  ) ENGINE=InnoDB`)
  await pool.query('CREATE TABLE IF NOT EXISTS analytics_schema_versions (component VARCHAR(80) PRIMARY KEY, version INT NOT NULL) ENGINE=InnoDB')
  await pool.execute('INSERT INTO analytics_schema_versions (component, version) VALUES (?, ?) ON DUPLICATE KEY UPDATE version = VALUES(version)', ['analytics', ANALYTICS_SCHEMA_VERSION])
}

export async function assertAnalyticsSchema(pool) {
  const [rows] = await pool.execute('SELECT version FROM analytics_schema_versions WHERE component = ?', ['analytics'])
  if (Number(rows[0]?.version) !== ANALYTICS_SCHEMA_VERSION) throw new Error('Analytics schema migration required. Run npm run db:migrate with the migration account.')
  await pool.query('SELECT visitor_id, session_id, event_type, page_path, target, section_id, duration_seconds, occurred_at FROM analytics_events LIMIT 0')
}

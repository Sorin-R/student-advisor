export const SUPPORT_SCHEMA_VERSION = 1

export async function migrateSupport(pool) {
  for (const [column, definition] of [
    ['student_read_at', 'TIMESTAMP NULL AFTER read_at'],
    ['updated_at', 'TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at'],
  ]) {
    try { await pool.query(`ALTER TABLE support_messages ADD COLUMN ${column} ${definition}`) }
    catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
  }
  await pool.query(`CREATE TABLE IF NOT EXISTS support_message_replies (
    id CHAR(36) PRIMARY KEY,
    support_message_id CHAR(36) NOT NULL,
    sender_user_id CHAR(36) NULL,
    sender_role ENUM('student','advisor','admin','moderator') NOT NULL,
    sender_name VARCHAR(200) NOT NULL,
    message TEXT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX support_reply_thread_idx (support_message_id, created_at),
    CONSTRAINT support_reply_message_fk FOREIGN KEY (support_message_id) REFERENCES support_messages(id) ON DELETE CASCADE,
    CONSTRAINT support_reply_sender_fk FOREIGN KEY (sender_user_id) REFERENCES users(id) ON DELETE SET NULL
  ) ENGINE=InnoDB`)
  await pool.query('CREATE TABLE IF NOT EXISTS support_schema_versions (component VARCHAR(80) PRIMARY KEY, version INT NOT NULL) ENGINE=InnoDB')
  await pool.execute('INSERT INTO support_schema_versions (component, version) VALUES (?, ?) ON DUPLICATE KEY UPDATE version = VALUES(version)', ['conversations', SUPPORT_SCHEMA_VERSION])
}

export async function assertSupportSchema(pool) {
  const [rows] = await pool.execute('SELECT version FROM support_schema_versions WHERE component = ?', ['conversations'])
  if (Number(rows[0]?.version) !== SUPPORT_SCHEMA_VERSION) throw new Error('Support conversation migration required. Run npm run db:migrate with the migration account.')
  await pool.query('SELECT student_read_at, updated_at FROM support_messages LIMIT 0')
  await pool.query('SELECT support_message_id, sender_role, sender_name, message FROM support_message_replies LIMIT 0')
}

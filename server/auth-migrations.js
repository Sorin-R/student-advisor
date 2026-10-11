export const AUTH_SCHEMA_VERSION = 1
async function addColumn(pool, table, definition) {
  try { await pool.query(`ALTER TABLE ${table} ADD COLUMN ${definition}`); return true } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error; return false }
}
export async function migrateAuth(pool) {
  await pool.query('CREATE TABLE IF NOT EXISTS security_schema_versions (component VARCHAR(80) PRIMARY KEY, version INT NOT NULL) ENGINE=InnoDB')
  await addColumn(pool, 'users', 'email_verified BOOLEAN NOT NULL DEFAULT FALSE')
  await addColumn(pool, 'users', 'auth_version INT NOT NULL DEFAULT 0')
  await addColumn(pool, 'users', 'totp_last_step BIGINT NULL')
  await addColumn(pool, 'users', 'login_failures INT NOT NULL DEFAULT 0')
  await addColumn(pool, 'users', 'login_locked_until DATETIME NULL')
  await addColumn(pool, 'users', 'mfa_failures INT NOT NULL DEFAULT 0')
  await addColumn(pool, 'users', 'mfa_locked_until DATETIME NULL')
  await pool.query(`CREATE TABLE IF NOT EXISTS auth_sessions (
    id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, authenticated_at DATETIME NOT NULL,
    expires_at DATETIME NOT NULL, revoked_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX auth_session_user_idx (user_id), INDEX auth_session_expiry_idx (expires_at),
    CONSTRAINT auth_session_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`)
  const addedSession = await addColumn(pool, 'refresh_tokens', 'session_id CHAR(36) NULL')
  if (addedSession) await pool.execute('UPDATE refresh_tokens SET revoked_at = COALESCE(revoked_at, UTC_TIMESTAMP()) WHERE session_id IS NULL')
  await pool.query(`CREATE TABLE IF NOT EXISTS auth_challenges (
    id CHAR(36) PRIMARY KEY, user_id CHAR(36) NULL, kind VARCHAR(32) NOT NULL, token_hash CHAR(64) NULL,
    payload JSON NULL, secret_enc TEXT NULL, attempts INT NOT NULL DEFAULT 0,
    expires_at DATETIME NOT NULL, consumed_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX auth_challenge_user_idx (user_id), INDEX auth_challenge_expiry_idx (expires_at), INDEX auth_challenge_hash_idx (token_hash),
    CONSTRAINT auth_challenge_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`)
  await pool.query(`CREATE TABLE IF NOT EXISTS auth_recovery_codes (
    id CHAR(36) PRIMARY KEY, user_id CHAR(36) NOT NULL, code_hash CHAR(64) NOT NULL,
    used_at DATETIME NULL, created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY auth_recovery_user_code_idx (user_id, code_hash),
    CONSTRAINT auth_recovery_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
  ) ENGINE=InnoDB`)
  await pool.execute('INSERT INTO security_schema_versions (component, version) VALUES (?, ?) ON DUPLICATE KEY UPDATE version = VALUES(version)', ['auth', AUTH_SCHEMA_VERSION])
}
export async function assertAuthSchema(pool) {
  const [rows] = await pool.execute('SELECT version FROM security_schema_versions WHERE component = ?', ['auth'])
  if (Number(rows[0]?.version) !== AUTH_SCHEMA_VERSION) throw new Error('Authentication schema migration is required. Run npm run db:migrate before starting this release.')
}

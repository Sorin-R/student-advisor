import mysql from 'mysql2'
import dotenv from 'dotenv'
import { readFileSync } from 'node:fs'

dotenv.config({ quiet: true, path: process.env.DOTENV_CONFIG_PATH || '.env' })

const config = {
  host: process.env.MYSQL_HOST || '127.0.0.1',
  port: Number(process.env.MYSQL_PORT || 3306),
  user: process.env.MYSQL_USER || 'root',
  password: process.env.MYSQL_PASSWORD || '',
  database: process.env.MYSQL_DATABASE || 'student_advisor',
  connectTimeout: 5000,
  waitForConnections: true,
  connectionLimit: 10,
  timezone: 'Z',
  ...(process.env.MYSQL_SOCKET ? { socketPath: process.env.MYSQL_SOCKET } : {}),
  ...(process.env.MYSQL_SSL === 'true' ? { ssl: { rejectUnauthorized: true, ...(process.env.MYSQL_SSL_CA ? { ca: readFileSync(process.env.MYSQL_SSL_CA, 'utf8') } : {}) } } : {}),
}

export const pool = mysql.createPool(config).promise()

export async function initDb(databasePool = pool) {
  if (process.env.MYSQL_SKIP_CREATE_DATABASE !== 'true') {
    const admin = await mysql.createConnection({ ...config, database: undefined }).promise()
    await admin.query(`CREATE DATABASE IF NOT EXISTS \`${config.database.replaceAll('`', '')}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`)
    await admin.end()
  }
  const statements = [
    `CREATE TABLE IF NOT EXISTS users (
      id CHAR(36) PRIMARY KEY,
      email VARCHAR(255) NOT NULL UNIQUE,
      password_hash VARCHAR(255) NULL,
      google_subject VARCHAR(255) NULL UNIQUE,
      role ENUM('student','advisor','admin','moderator') NOT NULL DEFAULT 'student',
      permissions JSON NULL,
      first_name VARCHAR(100) NULL,
      last_name VARCHAR(100) NULL,
      two_factor_enabled BOOLEAN NOT NULL DEFAULT FALSE,
      two_factor_secret_enc TEXT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS refresh_tokens (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      revoked_at DATETIME NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT refresh_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS applications (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL UNIQUE,
      data JSON NOT NULL,
      requested_documents JSON NULL,
      document_submissions JSON NULL,
      status ENUM('draft','in_review','submitted','offer_received','complete') NOT NULL DEFAULT 'draft',
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT application_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS application_document_files (
      application_id CHAR(36) NOT NULL,
      document_key VARCHAR(50) NOT NULL,
      file_name VARCHAR(255) NOT NULL,
      mime_type VARCHAR(100) NOT NULL,
      content LONGBLOB NOT NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (application_id, document_key),
      CONSTRAINT application_document_file_fk FOREIGN KEY (application_id) REFERENCES applications(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS support_messages (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NULL,
      name VARCHAR(200) NOT NULL,
      email VARCHAR(255) NOT NULL,
      topic VARCHAR(100) NOT NULL,
      message TEXT NOT NULL,
      read_at TIMESTAMP NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      CONSTRAINT support_message_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS password_reset_tokens (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      token_hash CHAR(64) NOT NULL UNIQUE,
      expires_at DATETIME NOT NULL,
      used_at DATETIME NULL,
      requested_ip VARCHAR(64) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX password_reset_user_idx (user_id),
      INDEX password_reset_expiry_idx (expires_at),
      CONSTRAINT password_reset_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS audit_logs (
      id CHAR(36) PRIMARY KEY,
      user_id CHAR(36) NOT NULL,
      action_type VARCHAR(80) NOT NULL,
      description VARCHAR(500) NOT NULL,
      metadata JSON NULL,
      ip_address VARCHAR(64) NULL,
      created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX audit_created_idx (created_at),
      INDEX audit_user_idx (user_id),
      INDEX audit_action_idx (action_type),
      CONSTRAINT audit_user_fk FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    ) ENGINE=InnoDB`,
    `CREATE TABLE IF NOT EXISTS site_content (
      content_key VARCHAR(120) PRIMARY KEY,
      content_value JSON NOT NULL,
      updated_by CHAR(36) NOT NULL,
      updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      CONSTRAINT site_content_user_fk FOREIGN KEY (updated_by) REFERENCES users(id)
    ) ENGINE=InnoDB`,
  ]
  for (const statement of statements) await databasePool.query(statement)
  try { await databasePool.query("ALTER TABLE users ADD COLUMN role ENUM('student','advisor') NOT NULL DEFAULT 'student'") } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
  await databasePool.query("ALTER TABLE users MODIFY COLUMN role ENUM('student','advisor','admin','moderator') NOT NULL DEFAULT 'student'")
  try { await databasePool.query('ALTER TABLE users ADD COLUMN permissions JSON NULL AFTER role') } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
  try { await databasePool.query('ALTER TABLE applications ADD COLUMN requested_documents JSON NULL AFTER data') } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
  try { await databasePool.query('ALTER TABLE applications ADD COLUMN document_submissions JSON NULL AFTER requested_documents') } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
  try { await databasePool.query('ALTER TABLE support_messages MODIFY user_id CHAR(36) NULL') } catch (error) { if (error.code !== 'ER_NO_SUCH_TABLE') throw error }
  try { await databasePool.query('ALTER TABLE support_messages ADD COLUMN read_at TIMESTAMP NULL AFTER message') } catch (error) { if (error.code !== 'ER_DUP_FIELDNAME') throw error }
}

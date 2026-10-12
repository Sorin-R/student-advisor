import 'dotenv/config'
import { pathToFileURL } from 'node:url'
import { pool, initDb } from './db.js'
import { migrateAuth } from './auth-migrations.js'
import { migrateApplications } from './application-migrations.js'
import { migrateHardening } from './hardening-migrations.js'
import { migrateSupport } from './support-migrations.js'
import { migrateAnalytics } from './analytics-migrations.js'

export async function migrateDatabase(databasePool = pool) {
  await initDb(databasePool)
  await migrateAuth(databasePool)
  await migrateApplications(databasePool)
  await migrateHardening(databasePool)
  await migrateSupport(databasePool)
  await migrateAnalytics(databasePool)
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { await migrateDatabase(); console.log('Schema migrations completed. Existing accounts must verify email; old sessions require a fresh sign-in.') }
  catch (error) { console.error('Migration failed:', error.code || error.name); process.exitCode = 1 }
  finally { await pool.end() }
}

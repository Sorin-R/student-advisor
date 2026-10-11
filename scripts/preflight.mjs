import 'dotenv/config'
import { checkProductionConfig } from '../server/config-check.js'

const result = await checkProductionConfig()
for (const message of result.errors) console.error(`REQUIRED: ${message}`)
for (const message of result.warnings) console.log(`VERIFY: ${message}`)
console.log(result.errors.length ? `Deployment is not ready: ${result.errors.length} configuration items require attention. No settings were changed.` : 'Configuration checks passed. Complete the documented staging checks before deployment.')
process.exitCode = result.errors.length ? 1 : 0

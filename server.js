// Hostinger Express entry point. Schema changes are run separately before production startup.
import { startServer } from './server/index.js'
startServer().catch((error) => { console.error('Server startup failed:', error.message); process.exit(1) })

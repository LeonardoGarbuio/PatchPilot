import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { db } from './client.js'
import { join } from 'path'
import { fileURLToPath } from 'url'
import { dirname } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

async function runMigrations() {
  console.log('Running database migrations...')
  migrate(db, { migrationsFolder: join(__dirname, 'migrations') })
  console.log('Migrations complete.')
}

runMigrations().catch((err) => {
  console.error('Migration failed:', err)
  process.exit(1)
})

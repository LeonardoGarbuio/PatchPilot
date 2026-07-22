import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { existsSync, mkdirSync } from 'fs'
import { join } from 'path'
import * as schema from './schema.js'

const DATA_DIR = process.env.DATA_DIR ?? join(process.cwd(), 'data')

if (!existsSync(DATA_DIR)) {
  mkdirSync(DATA_DIR, { recursive: true })
}

const sqlite = new Database(join(DATA_DIR, 'patchpilot.db'))

// Enable WAL mode for better concurrent read performance
sqlite.pragma('journal_mode = WAL')
sqlite.pragma('foreign_keys = ON')

export const db = drizzle(sqlite, { schema })
export type Db = typeof db

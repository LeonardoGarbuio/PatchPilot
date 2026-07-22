import { sql } from 'drizzle-orm'
import { integer, sqliteTable, text, real } from 'drizzle-orm/sqlite-core'

// ─── Users ────────────────────────────────────────────────────────────────────

export const users = sqliteTable('users', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  passwordHash: text('password_hash').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})

// ─── Jobs ─────────────────────────────────────────────────────────────────────

export const jobs = sqliteTable('jobs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  title: text('title').notNull(),
  task: text('task').notNull(),
  repo: text('repo').notNull(),
  sourceType: text('source_type', { enum: ['local', 'github', 'zip'] }).notNull(),
  status: text('status', {
    enum: ['idle', 'planning', 'awaiting_approval', 'running', 'verifying', 'complete', 'approved', 'rejected', 'failed'],
  })
    .notNull()
    .default('idle'),
  provider: text('provider', { enum: ['ollama', 'openai', 'anthropic'] })
    .notNull()
    .default('ollama'),
  model: text('model').notNull().default('qwen2.5-coder:7b'),
  plan: text('plan'), // JSON string of PlanStep[]
  multiSolution: integer('multi_solution', { mode: 'boolean' }).notNull().default(false),
  riskLevel: text('risk_level', { enum: ['low', 'medium', 'high'] }),
  riskNote: text('risk_note'),
  containerId: text('container_id'),
  workspacePath: text('workspace_path'),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
  startedAt: text('started_at'),
  finishedAt: text('finished_at'),
})

// ─── Run Events ───────────────────────────────────────────────────────────────

export const runEvents = sqliteTable('run_events', {
  id: text('id').primaryKey(),
  jobId: text('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  type: text('type', {
    enum: ['info', 'file_read', 'file_write', 'command', 'test', 'error', 'complete'],
  }).notNull(),
  title: text('title').notNull(),
  detail: text('detail'),
  elapsed: text('elapsed'),
  timestamp: text('timestamp')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})

// ─── File Changes ─────────────────────────────────────────────────────────────

export const fileChanges = sqliteTable('file_changes', {
  id: text('id').primaryKey(),
  jobId: text('job_id')
    .notNull()
    .references(() => jobs.id, { onDelete: 'cascade' }),
  solutionId: integer('solution_id').notNull().default(1),
  path: text('path').notNull(),
  status: text('status', { enum: ['new', 'modified', 'deleted'] }).notNull(),
  diff: text('diff').notNull(),
  additions: integer('additions').notNull().default(0),
  deletions: integer('deletions').notNull().default(0),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})

// ─── Diff Comments ────────────────────────────────────────────────────────────

export const diffComments = sqliteTable('diff_comments', {
  id: text('id').primaryKey(),
  fileChangeId: text('file_change_id')
    .notNull()
    .references(() => fileChanges.id, { onDelete: 'cascade' }),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  lineNumber: integer('line_number').notNull(),
  content: text('content').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})

// ─── Project Memory ───────────────────────────────────────────────────────────

export const projectMemory = sqliteTable('project_memory', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  repo: text('repo').notNull(),
  insight: text('insight').notNull(),
  createdAt: text('created_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})

// ─── Provider Config ──────────────────────────────────────────────────────────

export const providerConfigs = sqliteTable('provider_configs', {
  id: text('id').primaryKey(),
  userId: text('user_id')
    .notNull()
    .references(() => users.id, { onDelete: 'cascade' }),
  provider: text('provider', { enum: ['ollama', 'openai', 'anthropic'] }).notNull(),
  baseUrl: text('base_url'),
  model: text('model').notNull(),
  updatedAt: text('updated_at')
    .notNull()
    .default(sql`(strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))`),
})

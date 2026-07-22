import { z } from 'zod'

// ─── Job Status ──────────────────────────────────────────────────────────────

export const JobStatusSchema = z.enum([
  'idle',
  'planning',
  'awaiting_approval',
  'running',
  'verifying',
  'complete',
  'approved',
  'rejected',
  'failed',
])
export type JobStatus = z.infer<typeof JobStatusSchema>

// ─── Source ──────────────────────────────────────────────────────────────────

export const SourceTypeSchema = z.enum(['local', 'github', 'zip'])
export type SourceType = z.infer<typeof SourceTypeSchema>

// ─── AI Provider ─────────────────────────────────────────────────────────────

export const ProviderSchema = z.enum(['ollama', 'openai', 'anthropic'])
export type Provider = z.infer<typeof ProviderSchema>

// ─── Run Event ───────────────────────────────────────────────────────────────

export const RunEventTypeSchema = z.enum([
  'info',
  'file_read',
  'file_write',
  'command',
  'test',
  'error',
  'complete',
])
export type RunEventType = z.infer<typeof RunEventTypeSchema>

export const RunEventSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  type: RunEventTypeSchema,
  title: z.string(),
  detail: z.string().optional(),
  timestamp: z.string().datetime(),
  elapsed: z.string().optional(),
})
export type RunEvent = z.infer<typeof RunEventSchema>

// ─── Plan Step ───────────────────────────────────────────────────────────────

export const PlanStepSchema = z.object({
  index: z.number(),
  title: z.string(),
  description: z.string(),
  permission: z.enum(['read', 'write', 'verify']),
})
export type PlanStep = z.infer<typeof PlanStepSchema>

// ─── File Change ─────────────────────────────────────────────────────────────

export const FileChangeStatusSchema = z.enum(['new', 'modified', 'deleted'])
export type FileChangeStatus = z.infer<typeof FileChangeStatusSchema>

export const FileChangeSchema = z.object({
  id: z.string(),
  jobId: z.string(),
  path: z.string(),
  status: FileChangeStatusSchema,
  diff: z.string(),
  additions: z.number(),
  deletions: z.number(),
})
export type FileChange = z.infer<typeof FileChangeSchema>

// ─── Risk Level ──────────────────────────────────────────────────────────────

export const RiskLevelSchema = z.enum(['low', 'medium', 'high'])
export type RiskLevel = z.infer<typeof RiskLevelSchema>

// ─── Job ─────────────────────────────────────────────────────────────────────

export const JobSchema = z.object({
  id: z.string(),
  userId: z.string(),
  title: z.string(),
  task: z.string(),
  repo: z.string(),
  branch: z.string().optional(),
  status: JobStatusSchema,
  provider: ProviderSchema,
  model: z.string(),
  plan: z.array(PlanStepSchema).optional(),
  riskLevel: RiskLevelSchema.optional(),
  riskNote: z.string().optional(),
  containerId: z.string().optional(),
  createdAt: z.string().datetime(),
  startedAt: z.string().datetime().optional(),
  finishedAt: z.string().datetime().optional(),
})
export type Job = z.infer<typeof JobSchema>

// ─── Verification Result ──────────────────────────────────────────────────────

export const VerificationResultSchema = z.object({
  lint: z.enum(['passed', 'failed', 'skipped']),
  typecheck: z.enum(['passed', 'failed', 'skipped']),
  tests: z.enum(['passed', 'failed', 'skipped']),
  testCount: z.number(),
  build: z.enum(['passed', 'failed', 'skipped']),
})
export type VerificationResult = z.infer<typeof VerificationResultSchema>

// ─── API Request/Response Schemas ────────────────────────────────────────────

export const CreateJobRequestSchema = z.object({
  task: z.string().min(10).max(2000),
  repo: z.string().min(1),
  sourceType: SourceTypeSchema,
  provider: ProviderSchema.default('ollama'),
  model: z.string().default('qwen2.5-coder:7b'),
})
export type CreateJobRequest = z.infer<typeof CreateJobRequestSchema>

export const LoginRequestSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})
export type LoginRequest = z.infer<typeof LoginRequestSchema>

export const RegisterRequestSchema = LoginRequestSchema.extend({
  name: z.string().min(2),
})
export type RegisterRequest = z.infer<typeof RegisterRequestSchema>

// ─── SSE Event Payload ───────────────────────────────────────────────────────

export const SsePayloadSchema = z.discriminatedUnion('event', [
  z.object({ event: z.literal('run_event'), data: RunEventSchema }),
  z.object({ event: z.literal('status_change'), data: z.object({ status: JobStatusSchema }) }),
  z.object({ event: z.literal('plan_ready'), data: z.object({ plan: z.array(PlanStepSchema) }) }),
  z.object({ event: z.literal('complete'), data: z.object({ jobId: z.string() }) }),
  z.object({ event: z.literal('error'), data: z.object({ message: z.string() }) }),
])
export type SsePayload = z.infer<typeof SsePayloadSchema>

import type { FastifyInstance, FastifyRequest } from 'fastify'
import { desc, eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '../db/client.js'
import { fileChanges, jobs, runEvents } from '../db/schema.js'
import { JobRunner } from '../orchestrator/job-runner.js'
import { sseManager } from '../orchestrator/sse-manager.js'
import { CreateJobRequestSchema } from '@patchpilot/shared'

// Middleware to verify JWT on protected routes
async function authenticate(req: FastifyRequest, reply: any) {
  try {
    await req.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'Unauthorized' })
  }
}

export async function jobRoutes(app: FastifyInstance) {
  // GET /api/jobs — list all jobs for the current user
  app.get('/api/jobs', { preHandler: authenticate }, async (req: any, reply) => {
    const userId = req.user.sub as string
    const allJobs = await db
      .select()
      .from(jobs)
      .where(eq(jobs.userId, userId))
      .orderBy(desc(jobs.createdAt))
    return reply.send(allJobs)
  })

  // POST /api/jobs — create a new job
  app.post('/api/jobs', { preHandler: authenticate }, async (req: any, reply) => {
    const parsed = CreateJobRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { task, repo, sourceType, provider, model } = parsed.data
    const userId = req.user.sub as string
    const id = nanoid()

    // Derive a short human-readable title from the task
    const title = task.length > 60 ? task.slice(0, 57) + '…' : task

    await db.insert(jobs).values({ id, userId, title, task, repo, sourceType, provider, model })

    return reply.status(201).send({ id })
  })

  // GET /api/jobs/:id — get full job details with events and file changes
  app.get('/api/jobs/:id', { preHandler: authenticate }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user.sub as string

    const [job] = await db
      .select()
      .from(jobs)
      .where(eq(jobs.id, id))

    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })

    const events = await db
      .select()
      .from(runEvents)
      .where(eq(runEvents.jobId, id))
      .orderBy(runEvents.timestamp)

    const changes = await db
      .select()
      .from(fileChanges)
      .where(eq(fileChanges.jobId, id))

    return reply.send({
      ...job,
      plan: job.plan ? JSON.parse(job.plan) : null,
      events,
      changes,
    })
  })

  // POST /api/jobs/:id/plan — trigger plan generation
  app.post('/api/jobs/:id/plan', { preHandler: authenticate }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user.sub as string

    const [job] = await db.select().from(jobs).where(eq(jobs.id, id))
    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })
    if (job.status !== 'idle') return reply.status(409).send({ error: `Job is in state "${job.status}"` })

    // Run async, results streamed over SSE
    const runner = new JobRunner(id)
    runner.generatePlan().catch(console.error)

    return reply.status(202).send({ message: 'Plan generation started' })
  })

  // POST /api/jobs/:id/run — approve plan and start execution
  app.post('/api/jobs/:id/run', { preHandler: authenticate }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user.sub as string

    const [job] = await db.select().from(jobs).where(eq(jobs.id, id))
    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })
    if (job.status !== 'awaiting_approval') return reply.status(409).send({ error: `Job is in state "${job.status}"` })

    const runner = new JobRunner(id)
    runner.run().catch(console.error)

    return reply.status(202).send({ message: 'Run started' })
  })

  // POST /api/jobs/:id/approve — approve completed job
  app.post('/api/jobs/:id/approve', { preHandler: authenticate }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user.sub as string

    const [job] = await db.select().from(jobs).where(eq(jobs.id, id))
    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })
    if (job.status !== 'complete') return reply.status(409).send({ error: `Job must be complete to approve` })

    await db.update(jobs).set({ status: 'approved' }).where(eq(jobs.id, id))
    return reply.send({ message: 'Job approved' })
  })

  // POST /api/jobs/:id/reject — reject job
  app.post('/api/jobs/:id/reject', { preHandler: authenticate }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user.sub as string

    const [job] = await db.select().from(jobs).where(eq(jobs.id, id))
    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })

    await db.update(jobs).set({ status: 'rejected' }).where(eq(jobs.id, id))
    return reply.send({ message: 'Job rejected' })
  })

  // DELETE /api/jobs/:id
  app.delete('/api/jobs/:id', { preHandler: authenticate }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user.sub as string

    const [job] = await db.select().from(jobs).where(eq(jobs.id, id))
    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })

    await db.delete(jobs).where(eq(jobs.id, id))
    return reply.status(204).send()
  })

  // GET /api/jobs/:id/stream — SSE endpoint for real-time events
  app.get('/api/jobs/:id/stream', { preHandler: authenticate }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user.sub as string

    const [job] = await db.select().from(jobs).where(eq(jobs.id, id))
    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })

    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // disable nginx buffering
    })
    reply.raw.write(':ok\n\n') // initial heartbeat

    sseManager.register(id, reply)

    // Keep-alive ping every 25s (prevents proxy timeouts)
    const ping = setInterval(() => {
      try {
        reply.raw.write(': ping\n\n')
      } catch {
        clearInterval(ping)
      }
    }, 25_000)

    reply.raw.on('close', () => clearInterval(ping))
  })

  // GET /api/jobs/:id/patch — download .patch file
  app.get('/api/jobs/:id/patch', { preHandler: authenticate }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user.sub as string

    const [job] = await db.select().from(jobs).where(eq(jobs.id, id))
    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })
    if (!['complete', 'approved'].includes(job.status)) {
      return reply.status(409).send({ error: 'Patch not ready yet' })
    }

    const changes = await db.select().from(fileChanges).where(eq(fileChanges.jobId, id))
    const patch = changes.map((c) => c.diff).join('\n')

    reply.header('Content-Type', 'text/plain')
    reply.header('Content-Disposition', `attachment; filename="patchpilot-${id.slice(0, 8)}.patch"`)
    return reply.send(patch)
  })

  // POST /api/jobs/:id/pr — create a pull request
  app.post('/api/jobs/:id/pr', { preHandler: authenticate }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const { githubToken } = req.body as { githubToken?: string }
    const userId = req.user.sub as string

    if (!githubToken) return reply.status(400).send({ error: 'githubToken is required' })

    const [job] = await db.select().from(jobs).where(eq(jobs.id, id))
    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })
    if (job.status !== 'approved') return reply.status(409).send({ error: 'Job must be approved first' })
    if (job.sourceType !== 'github') return reply.status(400).send({ error: 'Job is not connected to a GitHub repository' })
    if (!job.workspacePath) return reply.status(500).send({ error: 'Workspace path not found' })

    const [owner, repo] = job.repo.split('/')
    if (!owner || !repo) return reply.status(400).send({ error: 'Invalid repo format' })

    const changes = await db.select().from(fileChanges).where(eq(fileChanges.jobId, id))
    const { readFileSync, existsSync } = await import('fs')
    const { join } = await import('path')

    const prChanges = changes.map(c => {
      const fullPath = join(job.workspacePath!, c.path)
      return {
        path: c.path,
        content: existsSync(fullPath) ? readFileSync(fullPath, 'utf-8') : null
      }
    })

    const { createPullRequest } = await import('@patchpilot/git')
    try {
      const prUrl = await createPullRequest({
        githubToken,
        owner,
        repo,
        branchName: `patchpilot/${id}`,
        title: `PatchPilot: ${job.title}`,
        body: `Automated changes generated by PatchPilot for job ${id}.\n\nTask: ${job.task}`,
        changes: prChanges
      })
      
      return reply.send({ url: prUrl })
    } catch (err: any) {
      req.log.error(err)
      return reply.status(500).send({ error: 'Failed to create PR', details: err.message })
    }
  })
}

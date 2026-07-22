import { eq, and } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '../db/client.js'
import { fileChanges, jobs, runEvents, projectMemory } from '../db/schema.js'
import { sseManager } from './sse-manager.js'
import type { Job, PlanStep, RunEvent } from '@patchpilot/shared'
import { assertTransition } from '@patchpilot/shared'

/**
 * Orchestrates the full lifecycle of a PatchPilot job:
 *   planning → awaiting_approval → running → verifying → complete
 *
 * Security guarantees:
 *   - Each job gets a fresh, isolated Docker container via packages/sandbox
 *   - Network is disabled during the edit phase
 *   - Containers are always destroyed on completion or failure
 *   - The AI agent can only call tools on the allowlist
 *   - Original repository is NEVER modified
 */
export class JobRunner {
  private jobId: string

  constructor(jobId: string) {
    this.jobId = jobId
  }

  private async updateStatus(status: Job['status']) {
    const [current] = await db
      .select({ status: jobs.status })
      .from(jobs)
      .where(eq(jobs.id, this.jobId))

    if (!current) throw new Error(`Job ${this.jobId} not found`)

    assertTransition(current.status as Job['status'], status)

    await db
      .update(jobs)
      .set({
        status,
        ...(status === 'running' ? { startedAt: new Date().toISOString() } : {}),
        ...(status === 'complete' || status === 'failed'
          ? { finishedAt: new Date().toISOString() }
          : {}),
      })
      .where(eq(jobs.id, this.jobId))

    sseManager.emit(this.jobId, { event: 'status_change', data: { status } })
  }

  private async addEvent(event: Omit<RunEvent, 'id' | 'jobId' | 'timestamp'>): Promise<RunEvent> {
    const id = nanoid()
    const timestamp = new Date().toISOString()

    await db.insert(runEvents).values({
      id,
      jobId: this.jobId,
      type: event.type,
      title: event.title,
      detail: event.detail,
      elapsed: event.elapsed,
      timestamp,
    })

    const fullEvent: RunEvent = { id, jobId: this.jobId, timestamp, ...event }
    sseManager.emit(this.jobId, { event: 'run_event', data: fullEvent })
    return fullEvent
  }

  async generatePlan(): Promise<PlanStep[]> {
    try {
      await this.updateStatus('planning')

      const [job] = await db.select().from(jobs).where(eq(jobs.id, this.jobId))
      if (!job) throw new Error('Job not found')

      await this.addEvent({ type: 'info', title: 'Analyzing repository structure…' })

      // Dynamically import to avoid loading the agent module unless needed
      const { createAgent } = await import('@patchpilot/agent')
      const agent = createAgent({ provider: job.provider as 'ollama' | 'openai' | 'anthropic', model: job.model })

      const repoPath = job.workspacePath || ''
      const plan = await agent.plan({ task: job.task, repoPath })

      await db
        .update(jobs)
        .set({ plan: JSON.stringify(plan) })
        .where(eq(jobs.id, this.jobId))

      await this.updateStatus('awaiting_approval')
      sseManager.emit(this.jobId, { event: 'plan_ready', data: { plan } })

      return plan
    } catch (err) {
      await this.addEvent({
        type: 'error',
        title: 'Planning failed',
        detail: err instanceof Error ? err.message : String(err),
      })
      await this.updateStatus('failed')
      sseManager.emit(this.jobId, { event: 'status_change', data: { status: 'failed' } })
      throw err
    }
  }

  async run(): Promise<void> {
    await this.updateStatus('running')

    const [job] = await db.select().from(jobs).where(eq(jobs.id, this.jobId))
    if (!job || !job.plan || !job.workspacePath) throw new Error('Job not ready to run')

    const plan: PlanStep[] = JSON.parse(job.plan)

    let sandbox: any = null
    try {
      // 1. Spin up isolated container
      const { createSandbox } = await import('@patchpilot/sandbox')
      sandbox = await createSandbox({ workspacePath: job.workspacePath })

      await this.addEvent({
        type: 'info',
        title: 'Isolated container started',
        detail: `Container ID: ${sandbox.containerId.slice(0, 12)}`,
      })

      await db.update(jobs).set({ containerId: sandbox.containerId }).where(eq(jobs.id, this.jobId))

      const memories = await db
        .select()
        .from(projectMemory)
        .where(
          and(eq(projectMemory.repo, job.repo), eq(projectMemory.userId, job.userId))
        )
      const memoryStrings = memories.map(m => m.insight)

      const numSolutions = job.multiSolution ? 2 : 1;
      let allPassed = false;
      const allChanges: any[] = [];

      // 3. Run each plan step
      const { createAgent } = await import('@patchpilot/agent')
      const agent = createAgent({ provider: job.provider as 'ollama' | 'openai' | 'anthropic', model: job.model })

      for (let solId = 1; solId <= numSolutions; solId++) {
        await this.addEvent({ type: 'info', title: `Starting Solution ${solId}/${numSolutions}` })
        
        if (solId > 1) {
          // Reset workspace for next solution
          await sandbox.exec('git clean -fd && git reset --hard HEAD')
        }

        const changes = await agent.execute({
          task: job.task + (solId > 1 ? ` (Note: Generate a DIFFERENT solution or approach than before)` : ''),
          plan,
          sandbox,
          projectMemory: memoryStrings,
          onEvent: (event: Omit<RunEvent, 'id' | 'jobId' | 'timestamp'>) => this.addEvent(event),
        })
        
        allChanges.push(...changes);

        // 3. Persist file changes
        for (const change of changes) {
          await db.insert(fileChanges).values({
            id: nanoid(),
            jobId: this.jobId,
            solutionId: solId,
            path: change.path,
            status: change.status,
            diff: change.diff,
            additions: change.additions,
            deletions: change.deletions,
          })
        }

        // 4. Verify
        await this.updateStatus('verifying')
        await this.addEvent({ type: 'info', title: `Running verification suite for solution ${solId}…` })
        const verifyResult = await sandbox.verify()

        await this.addEvent({
          type: verifyResult.allPassed ? 'test' : 'error',
          title: verifyResult.allPassed ? `Solution ${solId} checks passed` : `Solution ${solId} checks failed`,
          detail: [
            `lint: ${verifyResult.lint}`,
            `typecheck: ${verifyResult.typecheck}`,
            `tests: ${verifyResult.tests} (${verifyResult.testCount})`,
            `build: ${verifyResult.build}`,
          ].join(' · '),
        })
        
        if (verifyResult.allPassed) allPassed = true;
      }

      // 5. Extract Project Memory from all solutions
      try {
        const newMemory = await agent.extractMemory(job.task, allChanges)
        if (newMemory) {
          await db.insert(projectMemory).values({
            id: nanoid(),
            userId: job.userId,
            repo: job.repo,
            insight: newMemory,
          })
          await this.addEvent({ type: 'info', title: 'Extracted new project insight', detail: newMemory })
        }
      } catch (err) {
        console.error('Failed to extract memory', err)
      }

      if (!allPassed) {
        await this.addEvent({ type: 'error', title: 'Run failed', detail: 'Verification checks did not pass for any solution.' })
        await this.updateStatus('failed')
        sseManager.close(this.jobId)
        return
      }

      await this.updateStatus('complete')
      sseManager.close(this.jobId)
    } catch (err) {
      await this.addEvent({
        type: 'error',
        title: 'Run failed',
        detail: err instanceof Error ? err.message : String(err),
      })
      await this.updateStatus('failed')
      sseManager.close(this.jobId)
      throw err
    } finally {
      if (sandbox) {
        try {
          await sandbox.destroy()
          await this.addEvent({ type: 'info', title: 'Container destroyed — workspace clean' })
        } catch (cleanupErr) {
          console.error(`Failed to destroy sandbox for job ${this.jobId}`, cleanupErr)
        }
      }
    }
  }
}

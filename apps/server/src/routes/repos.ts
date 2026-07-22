import type { FastifyInstance } from 'fastify'
import { eq } from 'drizzle-orm'
import type { FastifyRequest } from 'fastify'
import { nanoid } from 'nanoid'
import { db } from '../db/client.js'
import { jobs } from '../db/schema.js'
import { existsSync, mkdirSync } from 'fs'
import { cp } from 'fs/promises'
import { join } from 'path'
import { pipeline } from 'stream/promises'
import { createWriteStream } from 'fs'
import AdmZip from 'adm-zip'
import { simpleGit } from 'simple-git'

const WORKSPACES_DIR = process.env.WORKSPACES_DIR ?? join(process.cwd(), 'workspaces')

if (!existsSync(WORKSPACES_DIR)) mkdirSync(WORKSPACES_DIR, { recursive: true })

// Middleware to verify JWT
async function authenticate(req: FastifyRequest, reply: any) {
  try { await req.jwtVerify() } catch { reply.status(401).send({ error: 'Unauthorized' }) }
}

export async function repoRoutes(app: FastifyInstance) {
  // POST /api/repos/upload — upload a ZIP file and attach to a job
  app.post('/api/repos/upload', { preHandler: authenticate }, async (req: any, reply) => {
    const { jobId } = req.query as { jobId: string }
    const userId = req.user.sub as string
    if (!jobId) return reply.status(400).send({ error: 'jobId query param required' })

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId))
    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })

    const data = await req.file()
    if (!data) return reply.status(400).send({ error: 'No file uploaded' })
    if (!data.filename.endsWith('.zip')) return reply.status(400).send({ error: 'Only .zip files accepted' })

    const workspaceId = nanoid()
    const workspacePath = join(WORKSPACES_DIR, workspaceId)
    mkdirSync(workspacePath, { recursive: true })

    const zipPath = join(workspacePath, 'upload.zip')
    await pipeline(data.file, createWriteStream(zipPath))
    
    // Fully consume any remaining multipart stream to avoid hanging the request
    let part
    try {
      while ((part = await req.file())) {
        if (part && part.file) part.file.resume()
      }
    } catch (e) {
      // ignore
    }

    const zip = new AdmZip(zipPath)
    
    // Zip Bomb protection
    const entries = zip.getEntries()
    if (entries.length > 50000) {
      return reply.status(400).send({ error: 'ZIP contains too many files' })
    }
    
    let totalSize = 0
    for (const entry of entries) {
      totalSize += entry.header.size
    }
    if (totalSize > 2 * 1024 * 1024 * 1024) { // 2 GB uncompressed limit
      return reply.status(400).send({ error: 'ZIP uncompressed size exceeds limit' })
    }

    zip.extractAllTo(join(workspacePath, 'repo'), true)

    await db.update(jobs).set({ workspacePath: join(workspacePath, 'repo') }).where(eq(jobs.id, jobId))

    return reply.send({ workspacePath: join(workspacePath, 'repo') })
  })

  // POST /api/repos/clone — clone a public GitHub URL
  app.post('/api/repos/clone', { preHandler: authenticate }, async (req: any, reply) => {
    const { url, jobId } = req.body as { url: string; jobId: string }
    const userId = req.user.sub as string
    if (!url || !jobId) return reply.status(400).send({ error: 'url and jobId required' })

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId))
    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })

    // Safety: only allow public git URLs, never local paths
    if (!url.startsWith('https://github.com/') && !url.startsWith('https://gitlab.com/')) {
      return reply.status(400).send({ error: 'Only public GitHub and GitLab URLs are allowed' })
    }

    const workspaceId = nanoid()
    const workspacePath = join(WORKSPACES_DIR, workspaceId, 'repo')
    mkdirSync(workspacePath, { recursive: true })

    try {
      const git = simpleGit()
      await git.clone(url, workspacePath, ['--depth', '1'])
    } catch (err) {
      return reply.status(422).send({ error: `Clone failed: ${err instanceof Error ? err.message : err}` })
    }

    await db.update(jobs).set({ workspacePath }).where(eq(jobs.id, jobId))

    return reply.send({ workspacePath })
  })

  // POST /api/repos/local — copy a local folder into an isolated workspace
  app.post('/api/repos/local', { preHandler: authenticate }, async (req: any, reply) => {
    const { path, jobId } = req.body as { path: string; jobId: string }
    const userId = req.user.sub as string
    if (!path || !jobId) return reply.status(400).send({ error: 'path and jobId required' })

    const [job] = await db.select().from(jobs).where(eq(jobs.id, jobId))
    if (!job || job.userId !== userId) return reply.status(404).send({ error: 'Job not found' })

    if (!existsSync(path)) return reply.status(400).send({ error: 'Local path does not exist' })

    const workspaceId = nanoid()
    const workspacePath = join(WORKSPACES_DIR, workspaceId, 'repo')
    mkdirSync(workspacePath, { recursive: true })

    try {
      await cp(path, workspacePath, { recursive: true, filter: (src) => !src.includes('node_modules') && !src.includes('.git') })
    } catch (err) {
      return reply.status(500).send({ error: `Copy failed: ${err instanceof Error ? err.message : err}` })
    }

    await db.update(jobs).set({ workspacePath }).where(eq(jobs.id, jobId))

    return reply.send({ workspacePath })
  })
}

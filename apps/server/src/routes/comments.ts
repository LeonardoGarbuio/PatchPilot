import type { FastifyInstance, FastifyRequest } from 'fastify'
import { eq } from 'drizzle-orm'
import { nanoid } from 'nanoid'
import { db } from '../db/client.js'
import { diffComments } from '../db/schema.js'
import { z } from 'zod'

const CreateCommentSchema = z.object({
  lineNumber: z.number().int().min(1),
  content: z.string().min(1).max(2000),
})

async function authenticate(req: FastifyRequest, reply: any) {
  try {
    await req.jwtVerify()
  } catch {
    reply.status(401).send({ error: 'Unauthorized' })
  }
}

export async function commentRoutes(app: FastifyInstance) {
  // GET /api/file-changes/:id/comments — list comments for a file change
  app.get('/api/file-changes/:id/comments', { preHandler: authenticate }, async (req: any, reply) => {
    const { id: fileChangeId } = req.params as { id: string }
    const comments = await db
      .select()
      .from(diffComments)
      .where(eq(diffComments.fileChangeId, fileChangeId))
    return reply.send(comments)
  })

  // POST /api/file-changes/:id/comments — add a new comment
  app.post('/api/file-changes/:id/comments', { preHandler: authenticate }, async (req: any, reply) => {
    const { id: fileChangeId } = req.params as { id: string }
    const parsed = CreateCommentSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { lineNumber, content } = parsed.data
    const userId = req.user.sub as string
    const id = nanoid()

    await db.insert(diffComments).values({
      id,
      fileChangeId,
      userId,
      lineNumber,
      content,
    })

    return reply.status(201).send({ id })
  })

  // DELETE /api/comments/:id — delete a comment
  app.delete('/api/comments/:id', { preHandler: authenticate }, async (req: any, reply) => {
    const { id } = req.params as { id: string }
    const userId = req.user.sub as string

    const [comment] = await db
      .select()
      .from(diffComments)
      .where(eq(diffComments.id, id))

    if (!comment || comment.userId !== userId) return reply.status(404).send({ error: 'Comment not found' })

    await db.delete(diffComments).where(eq(diffComments.id, id))
    return reply.status(204).send()
  })
}

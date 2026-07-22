import type { FastifyReply } from 'fastify'
import type { SsePayload } from '@patchpilot/shared'

type SseClient = { reply: FastifyReply; jobId: string }

const clients = new Map<string, Set<SseClient>>()

export const sseManager = {
  /**
   * Register a new SSE connection for a job.
   */
  register(jobId: string, reply: FastifyReply) {
    if (!clients.has(jobId)) clients.set(jobId, new Set())
    const client: SseClient = { reply, jobId }
    clients.get(jobId)!.add(client)

    reply.raw.on('close', () => {
      clients.get(jobId)?.delete(client)
      if (clients.get(jobId)?.size === 0) clients.delete(jobId)
    })
  },

  /**
   * Emit a typed SSE payload to all listeners of a job.
   */
  emit(jobId: string, payload: SsePayload) {
    const jobClients = clients.get(jobId)
    if (!jobClients || jobClients.size === 0) return

    const data = `data: ${JSON.stringify(payload)}\n\n`

    for (const client of jobClients) {
      try {
        client.reply.raw.write(data)
      } catch {
        jobClients.delete(client)
      }
    }
  },

  /**
   * Close all SSE connections for a job.
   */
  close(jobId: string) {
    const jobClients = clients.get(jobId)
    if (!jobClients) return
    for (const client of jobClients) {
      try {
        client.reply.raw.write('event: complete\ndata: {}\n\n')
        client.reply.raw.end()
      } catch {
        // ignore disconnected clients
      }
    }
    clients.delete(jobId)
  },

  /**
   * Number of active listeners for a given job.
   */
  listenerCount(jobId: string) {
    return clients.get(jobId)?.size ?? 0
  },
}

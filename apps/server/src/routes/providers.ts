import type { FastifyInstance } from 'fastify'

export async function providerRoutes(app: FastifyInstance) {
  // GET /api/providers/status — check if Ollama + Docker are reachable
  app.get('/api/providers/status', async (_req, reply) => {
    const [ollamaStatus, dockerStatus] = await Promise.allSettled([
      checkOllama(),
      checkDocker(),
    ])

    return reply.send({
      ollama: {
        online: ollamaStatus.status === 'fulfilled' && ollamaStatus.value.online,
        models: ollamaStatus.status === 'fulfilled' ? ollamaStatus.value.models : [],
        url: process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434',
      },
      docker: {
        online: dockerStatus.status === 'fulfilled' && dockerStatus.value,
      },
    })
  })
}

async function checkOllama(): Promise<{ online: boolean; models: string[] }> {
  const baseUrl = process.env.OLLAMA_BASE_URL ?? 'http://localhost:11434'
  const res = await fetch(`${baseUrl}/api/tags`, { signal: AbortSignal.timeout(3000) })
  if (!res.ok) return { online: false, models: [] }
  const json = await res.json() as { models: Array<{ name: string }> }
  return { online: true, models: json.models.map((m) => m.name) }
}

async function checkDocker(): Promise<boolean> {
  const { createSandbox } = await import('@patchpilot/sandbox')
  return createSandbox.isDockerAvailable()
}

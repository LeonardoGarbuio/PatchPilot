import Fastify from 'fastify'
import cors from '@fastify/cors'
import jwt from '@fastify/jwt'
import multipart from '@fastify/multipart'
import { authRoutes } from './routes/auth.js'
import { jobRoutes } from './routes/jobs.js'
import { providerRoutes } from './routes/providers.js'
import { repoRoutes } from './routes/repos.js'
import { commentRoutes } from './routes/comments.js'
import { systemRoutes } from './routes/system.js'
import fastifyCookie from '@fastify/cookie'
import fastifyRateLimit from '@fastify/rate-limit'

const PORT = Number(process.env.PORT ?? 3001)

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be explicitly set in production environments')
}
const JWT_SECRET = process.env.JWT_SECRET ?? 'patchpilot-dev-secret-change-in-production'

async function build() {
  const app = Fastify({
    logger: {
      level: process.env.LOG_LEVEL ?? 'info',
      transport: process.env.NODE_ENV !== 'production'
        ? { target: 'pino-pretty', options: { colorize: true } }
        : undefined,
    },
  })

  // ─── Plugins ──────────────────────────────────────────────────────────────

  await app.register(cors, {
    origin: process.env.CORS_ORIGIN ?? ['http://localhost:5173', 'https://*.vercel.app'],
    credentials: true,
  })

  await app.register(fastifyCookie)
  
  await app.register(fastifyRateLimit, {
    max: 100,
    timeWindow: '1 minute'
  })

  await app.register(jwt, {
    secret: JWT_SECRET,
    sign: { expiresIn: '7d' },
    cookie: {
      cookieName: 'token',
      signed: false
    }
  })

  await app.register(multipart, {
    limits: { fileSize: 1024 * 1024 * 1024 }, // 1 GB
  })

  // ─── Routes ───────────────────────────────────────────────────────────────

  await app.register(authRoutes)
  await app.register(jobRoutes)
  await app.register(providerRoutes)
  await app.register(repoRoutes)
  await app.register(commentRoutes)
  await app.register(systemRoutes)

  // ─── Health check ─────────────────────────────────────────────────────────

  app.get('/health', async () => ({
    status: 'ok',
    version: '0.1.0',
    uptime: process.uptime(),
  }))

  // ─── Global error handler ─────────────────────────────────────────────────

  app.setErrorHandler((error: any, _req, reply) => {
    app.log.error(error)
    reply.status(error.statusCode ?? 500).send({
      error: process.env.NODE_ENV === 'production' ? 'Internal server error' : error.message,
    })
  })

  return app
}

async function start() {
  const app = await build()
  try {
    await app.listen({ port: PORT, host: '0.0.0.0' })
  } catch (err) {
    app.log.error(err)
    process.exit(1)
  }

  // Graceful shutdown
  const shutdown = async (signal: string) => {
    app.log.info(`Received ${signal}, shutting down…`)
    await app.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => shutdown('SIGTERM'))
  process.on('SIGINT', () => shutdown('SIGINT'))
}

start()

// Trigger watch restart

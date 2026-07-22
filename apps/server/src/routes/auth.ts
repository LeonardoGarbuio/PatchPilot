import type { FastifyInstance } from 'fastify'
import bcrypt from 'bcrypt'
import { nanoid } from 'nanoid'
import { eq } from 'drizzle-orm'
import { db } from '../db/client.js'
import { users } from '../db/schema.js'
import { LoginRequestSchema, RegisterRequestSchema } from '@patchpilot/shared'

export async function authRoutes(app: FastifyInstance) {
  // POST /api/auth/register
  app.post('/api/auth/register', {
    config: { rateLimit: { max: 5, timeWindow: '1 minute' } }
  }, async (req, reply) => {
    const parsed = RegisterRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { email, password, name } = parsed.data
    
    if (password.length < 12 || password === 'local12345678') {
      return reply.status(400).send({ error: 'Password must be at least 12 characters and not easily guessable' })
    }

    const existing = await db.select().from(users).where(eq(users.email, email)).get()
    if (existing) return reply.status(409).send({ error: 'Email already in use' })

    const passwordHash = await bcrypt.hash(password, 12)
    const id = nanoid()

    await db.insert(users).values({ id, name, email, passwordHash })

    const token = app.jwt.sign({ sub: id, email })
    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60
    })
    return reply.status(201).send({ user: { id, name, email } })
  })

  // POST /api/auth/login
  app.post('/api/auth/login', {
    config: { rateLimit: { max: 10, timeWindow: '1 minute' } }
  }, async (req, reply) => {
    const parsed = LoginRequestSchema.safeParse(req.body)
    if (!parsed.success) return reply.status(400).send({ error: parsed.error.flatten() })

    const { email, password } = parsed.data

    const user = await db.select().from(users).where(eq(users.email, email)).get()
    if (!user) return reply.status(401).send({ error: 'Invalid credentials' })

    const valid = await bcrypt.compare(password, user.passwordHash)
    if (!valid) return reply.status(401).send({ error: 'Invalid credentials' })

    const token = app.jwt.sign({ sub: user.id, email: user.email })
    reply.setCookie('token', token, {
      path: '/',
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60
    })
    return reply.send({ user: { id: user.id, name: user.name, email: user.email } })
  })
  
  // GET /api/auth/me
  app.get('/api/auth/me', async (req, reply) => {
    try {
      await req.jwtVerify()
      return reply.send({ user: req.user })
    } catch {
      return reply.status(401).send({ error: 'Unauthorized' })
    }
  })
}

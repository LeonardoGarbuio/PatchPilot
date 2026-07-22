import { test, expect } from 'vitest'
import Fastify from 'fastify'
import { commentRoutes } from './comments.js'

test('commentRoutes enforces authentication', async () => {
  const app = Fastify()
  app.decorateRequest('jwtVerify', async function() { throw new Error('Unauth') })
  await app.register(commentRoutes)
  
  const res = await app.inject({
    method: 'GET',
    url: '/api/file-changes/fake-id/comments'
  })
  
  expect(res.statusCode).toBe(401)
})

test('commentRoutes enforces ownership (returns 404 if file change does not belong to user)', async () => {
  const app = Fastify()
  // Mock successful authentication with a fake user ID
  app.decorateRequest('jwtVerify', async function() { this.user = { sub: 'fake-user-id' } })
  app.decorateRequest('user', { sub: 'fake-user-id' })
  await app.register(commentRoutes)
  
  const res = await app.inject({
    method: 'GET',
    url: '/api/file-changes/fake-id/comments'
  })
  
  // Since fake-id doesn't exist in DB (or doesn't belong to fake-user-id), it should return 404
  expect(res.statusCode).toBe(404)
})


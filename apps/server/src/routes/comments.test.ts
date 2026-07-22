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

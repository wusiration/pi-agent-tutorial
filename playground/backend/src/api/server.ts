import Fastify from 'fastify'
import cors from '@fastify/cors'
import { registerRoutes } from './routes.js'

export async function createServer() {
  const app = Fastify({
    logger: { level: 'warn' },
  })

  await app.register(cors, {
    origin: true,
    credentials: true,
  })

  await registerRoutes(app)

  return app
}

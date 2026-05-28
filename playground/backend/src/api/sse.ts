import type { FastifyReply } from 'fastify'
import type { AgentEvent } from '../../../shared/types.js'

export class SSEConnection {
  private reply: FastifyReply
  private closed = false

  constructor(reply: FastifyReply) {
    this.reply = reply
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    })
  }

  send(event: AgentEvent) {
    if (this.closed) return
    this.reply.raw.write(`data: ${JSON.stringify(event)}\n\n`)
  }

  close() {
    if (this.closed) return
    this.closed = true
    this.reply.raw.end()
  }

  isClosed() {
    return this.closed
  }
}

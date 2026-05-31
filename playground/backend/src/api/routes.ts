import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'
import { randomUUID } from 'node:crypto'
import { Agent } from '../core/agent.js'
import { weatherTool, calculatorTool, searchTool } from '../tools/index.js'
import { SessionManager } from '../session/session-manager.js'
import { SSEConnection } from './sse.js'
import type { ChatRequest } from '../../../shared/types.js'

// 请求体验证 Schema
const ChatRequestSchema = Type.Object({
  message: Type.String({ minLength: 1, maxLength: 8000 }),
  sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
  useMock: Type.Optional(Type.Boolean()),
})

const ResetRequestSchema = Type.Object({
  sessionId: Type.Optional(Type.String({ minLength: 1, maxLength: 128 })),
})

// 会话管理器（统一持有 Agent，带 TTL 和容量限制）
const sessionManager = new SessionManager({
  ttlMs: 24 * 60 * 60 * 1000,  // 24 小时过期
  maxSessions: 1000,            // 最多 1000 个会话
  maxMessages: 500,             // 单个会话最多 500 条消息
})

function createAgent(): Agent {
  return new Agent({
    initialState: {
      systemPrompt: 'You are a helpful assistant. You have access to weather, calculator, and search tools.',
      messages: [],
      tools: [weatherTool, calculatorTool, searchTool],
    },
    maxMessages: sessionManager.getMaxMessages(),
  })
}

function getOrCreateAgent(sessionId: string): Agent {
  let session = sessionManager.get(sessionId)
  if (!session) {
    const agent = createAgent()
    sessionManager.create(sessionId, agent)
    session = sessionManager.get(sessionId)
  }
  return session!.agent
}

export async function registerRoutes(app: FastifyInstance) {
  // 健康检查
  app.get('/api/health', async () => ({ status: 'ok', timestamp: Date.now() }))

  // 获取可用工具列表
  app.get('/api/tools', async () => {
    return [weatherTool, calculatorTool, searchTool].map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description,
      parameters: t.parameters,
    }))
  })

  // 获取会话统计
  app.get('/api/stats', async () => {
    return sessionManager.getStats()
  })

  // 新建会话
  app.post('/api/sessions', async () => {
    const sessionId = `sess-${randomUUID()}`
    getOrCreateAgent(sessionId)
    return { sessionId }
  })

  // 发送消息（SSE 流式返回）
  app.post('/api/chat', {
    schema: {
      body: ChatRequestSchema,
    },
  }, async (request, reply) => {
    const body = request.body as Static<typeof ChatRequestSchema>

    // 必须先创建 session
    const sessionId = body.sessionId
    if (!sessionId) {
      reply.status(400)
      return { error: 'sessionId is required. Call POST /api/sessions first.' }
    }

    const agent = sessionManager.getAgent(sessionId)
    if (!agent) {
      reply.status(404)
      return { error: 'Session not found', code: 'SESSION_NOT_FOUND' }
    }

    // 并发检查：如果 Agent 正在处理请求，返回 409
    if (agent.state.isStreaming) {
      reply.status(409)
      return { error: 'Agent is already streaming', code: 'CONFLICT' }
    }

    const sse = new SSEConnection(reply)
    let unsubscribe: (() => void) | null = null

    // 每个请求独立的 AbortController
    const controller = new AbortController()
    agent.setAbortController(controller)

    // 客户端断开时清理
    request.raw.on('close', () => {
      if (!sse.isClosed()) {
        controller.abort()
        sse.close()
      }
    })

    // 订阅事件并转发到 SSE
    unsubscribe = agent.subscribe((event) => {
      sse.send(event)
      if (event.type === 'agent_end') {
        sse.close()
      }
    })

    // 启动 Agent
    try {
      await agent.prompt(body.message, { useMock: body.useMock, signal: controller.signal })
    } catch (error: any) {
      if (error.message !== 'Aborted' && error.name !== 'AbortError') {
        console.error('[API /chat] Agent error:', error)
        sse.send({
          type: 'agent_end',
          status: 'error',
          messages: agent.state.messages,
          error: { code: 'INTERNAL_ERROR', message: error.message || '未知错误' },
        })
      }
      sse.close()
    } finally {
      unsubscribe?.()
    }

    return reply
  })

  // 重置会话
  app.post('/api/reset', {
    schema: {
      body: ResetRequestSchema,
    },
  }, async (request) => {
    const body = request.body as Static<typeof ResetRequestSchema>
    const sessionId = body.sessionId
    if (!sessionId) {
      return { success: false, error: 'sessionId is required' }
    }
    sessionManager.clear(sessionId)
    return { success: true }
  })

  // 获取会话历史
  app.get('/api/history', async (request, reply) => {
    const { sessionId } = request.query as { sessionId?: string }
    if (!sessionId) {
      reply.status(400)
      return { error: 'sessionId is required' }
    }
    const agent = sessionManager.getAgent(sessionId)
    if (!agent) {
      reply.status(404)
      return { error: 'Session not found' }
    }
    return { messages: agent.state.messages || [] }
  })

  // 导出会话
  app.get('/api/export', async (request, reply) => {
    const { sessionId } = request.query as { sessionId?: string }
    if (!sessionId) {
      reply.status(400)
      return { error: 'sessionId is required' }
    }
    const agent = sessionManager.getAgent(sessionId)
    if (!agent) {
      reply.status(404)
      return { error: 'Session not found' }
    }

    reply.header('Content-Type', 'application/json')
    reply.header('Content-Disposition', `attachment; filename="session-${sessionId}.json"`)
    return {
      messages: agent.state.messages,
      exportedAt: new Date().toISOString(),
    }
  })

  // 服务关闭时释放资源
  app.addHook('onClose', async () => {
    sessionManager.dispose()
  })
}

import type { FastifyInstance } from 'fastify'
import { Type } from '@sinclair/typebox'
import type { Static } from '@sinclair/typebox'
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

// 会话管理器（带 TTL 和容量限制）
const sessionManager = new SessionManager({
  ttlMs: 24 * 60 * 60 * 1000,  // 24 小时过期
  maxSessions: 1000,            // 最多 1000 个会话
  maxMessages: 500,             // 单个会话最多 500 条消息
})

// Agent 实例缓存
const agents = new Map<string, Agent>()

function getOrCreateAgent(sessionId: string): Agent {
  if (!agents.has(sessionId)) {
    const agent = new Agent({
      initialState: {
        systemPrompt: 'You are a helpful assistant. You have access to weather, calculator, and search tools.',
        messages: [],
        tools: [weatherTool, calculatorTool, searchTool],
      },
    })
    agents.set(sessionId, agent)
    sessionManager.create(sessionId)
  }
  return agents.get(sessionId)!
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
    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
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

    // 不再回退到 'default'，没有 sessionId 时自动创建新会话
    let sessionId = body.sessionId
    if (!sessionId) {
      sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
      getOrCreateAgent(sessionId)
    }

    const agent = getOrCreateAgent(sessionId)
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
        unsubscribe?.()
      }
    })

    // 订阅事件并转发到 SSE
    unsubscribe = agent.subscribe((event) => {
      sse.send(event)
      if (event.type === 'agent_end' || event.type === 'agent_error') {
        sse.close()
        unsubscribe?.()
      }
    })

    // 启动 Agent
    try {
      await agent.prompt(body.message, { useMock: body.useMock, signal: controller.signal })
    } catch (error: any) {
      if (error.message !== 'Aborted' && error.name !== 'AbortError') {
        console.error('[API /chat] Agent error:', error)
        sse.send({
          type: 'agent_error',
          code: 'INTERNAL_ERROR',
          message: error.message || '未知错误',
        })
      }
      sse.close()
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
    const agent = agents.get(sessionId)
    if (agent) {
      agent.reset()
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
    const agent = agents.get(sessionId)
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
    const agent = agents.get(sessionId)
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
}

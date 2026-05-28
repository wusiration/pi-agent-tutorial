# 04 后端：HTTP API 与 SSE

> 核心逻辑已经写好，现在需要暴露给前端。我们用 Fastify 提供 REST API，用 SSE（Server-Sent Events）推送流式事件。

## 为什么选择 SSE？

| 方案 | 优点 | 缺点 |
|------|------|------|
| **SSE** | 基于 HTTP，自动重连，浏览器原生支持 | 单向（服务器→客户端） |
| WebSocket | 双向，低延迟 | 需要额外协议，复杂度高 |
| 长轮询 | 兼容性好 | 延迟高，浪费资源 |

对于 Agent 场景，事件流是**服务器单向推送**的，SSE 完全够用。

## 文件 1：api/sse.ts

封装 SSE 连接管理：

```ts
// backend/src/api/sse.ts
import type { FastifyReply } from 'fastify'
import type { AgentEvent } from '../../shared/types.js'

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
```

## 文件 2：api/routes.ts

```ts
// backend/src/api/routes.ts
import type { FastifyInstance } from 'fastify'
import { Agent } from '../core/agent.js'
import { weatherTool, calculatorTool, searchTool } from '../core/builtin-tools.js'
import { SSEConnection } from './sse.js'

// 内存会话存储
const sessions = new Map<string, Agent>()

function getOrCreateAgent(sessionId: string): Agent {
  if (!sessions.has(sessionId)) {
    const agent = new Agent({
      initialState: {
        systemPrompt: 'You are a helpful assistant. You have access to weather, calculator, and search tools.',
        messages: [],
        tools: [weatherTool, calculatorTool, searchTool],
      },
    })
    sessions.set(sessionId, agent)
  }
  return sessions.get(sessionId)!
}

export async function registerRoutes(app: FastifyInstance) {
  // 健康检查
  app.get('/api/health', async () => ({ status: 'ok' }))

  // 获取可用工具列表
  app.get('/api/tools', async () => {
    return [weatherTool, calculatorTool, searchTool].map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description,
      parameters: t.parameters,
    }))
  })

  // 新建会话
  app.post('/api/sessions', async () => {
    const sessionId = `sess-${Date.now()}-${Math.random().toString(36).slice(2)}`
    getOrCreateAgent(sessionId)
    return { sessionId }
  })

  // 发送消息（SSE 流式返回）
  app.post('/api/chat', async (request, reply) => {
    const body = request.body as { message: string; sessionId?: string; useMock?: boolean }
    const sessionId = body.sessionId || 'default'
    const agent = getOrCreateAgent(sessionId)

    const sse = new SSEConnection(reply)

    // 订阅事件并转发到 SSE
    const unsubscribe = agent.subscribe((event) => {
      sse.send(event)
      if (event.type === 'agent_end') {
        sse.close()
        unsubscribe()
      }
    })

    // 客户端断开时取消
    request.raw.on('close', () => {
      sse.close()
      unsubscribe()
    })

    // 启动 Agent
    try {
      await agent.prompt(body.message, { useMock: body.useMock })
    } catch (error: any) {
      sse.send({ type: 'message_update', message: { role: 'assistant', content: [{ type: 'text', text: `Error: ${error.message}` }], stopReason: 'error', timestamp: Date.now() }, delta: '' })
      sse.close()
    }

    return reply
  })

  // 重置会话
  app.post('/api/reset', async (request) => {
    const body = request.body as { sessionId?: string }
    const sessionId = body.sessionId || 'default'
    const agent = sessions.get(sessionId)
    if (agent) {
      agent.reset()
    }
    return { success: true }
  })

  // 获取会话历史
  app.get('/api/history', async (request) => {
    const { sessionId } = request.query as { sessionId?: string }
    const agent = sessions.get(sessionId || 'default')
    return { messages: agent?.state.messages || [] }
  })
}
```

## 文件 3：api/server.ts

```ts
// backend/src/api/server.ts
import Fastify from 'fastify'
import cors from '@fastify/cors'
import { registerRoutes } from './routes.js'

export async function createServer() {
  const app = Fastify({ logger: true })

  await app.register(cors, {
    origin: true,
    credentials: true,
  })

  await registerRoutes(app)

  return app
}
```

## 文件 4：index.ts（入口）

```ts
// backend/src/index.ts
import { createServer } from './api/server.js'

async function main() {
  const app = await createServer()
  const port = parseInt(process.env.PORT || '3000')

  await app.listen({ port, host: '0.0.0.0' })
  console.log(`Server running at http://localhost:${port}`)
}

main().catch(console.error)
```

## 测试 API

### 1. 健康检查

```bash
curl http://localhost:3000/api/health
# {"status":"ok"}
```

### 2. 新建会话

```bash
curl -X POST http://localhost:3000/api/sessions
# {"sessionId":"sess-..."}
```

### 3. 流式聊天（SSE）

```bash
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","useMock":true}'

# data: {"type":"agent_start"}
# data: {"type":"message_start","message":{...}}
# data: {"type":"message_update","message":{...},"delta":"M"}
# data: {"type":"message_update","message":{...},"delta":"o"}
# ...
# data: {"type":"agent_end","messages":[...]}
```

### 4. 获取历史

```bash
curl "http://localhost:3000/api/history?sessionId=default"
```

## SSE 事件格式

前端解析 SSE 时，每行数据以 `data: ` 开头：

```
data: {"type":"message_update","delta":"H"}\n\n
data: {"type":"message_update","delta":"i"}\n\n
```

浏览器 `EventSource` 会自动把每段数据作为 `message` 事件抛出，`event.data` 就是 JSON 字符串。

## 本章小结

- Fastify 提供轻量高效的 HTTP 服务。
- SSE 是 Agent 事件流的最佳传输方案，简单、可靠、自动重连。
- 内存会话存储适合教学场景，生产环境可替换为 Redis / 数据库。
- `/api/chat` 是核心端点，把 Agent 事件流转换为 SSE 流。

## 常见错误

❌ **SSE 事件没有 `\n\n` 结尾**
> SSE 规范要求每个事件以两个换行符结束。如果忘记写，浏览器不会触发 `onmessage`。

❌ **在 SSE 连接里返回普通 JSON**
> 一旦开始 SSE 流，就不能再返回普通 HTTP 响应。错误应该通过 SSE 事件发送。

❌ **没有处理客户端断开**
> 如果用户关闭浏览器标签，`request.raw` 的 `close` 事件会触发，需要清理订阅避免内存泄漏。

## 下一步

前端已经可以通过 `EventSource` 或 `fetch` + `ReadableStream` 消费这些 SSE 事件了。下一章实现 React 聊天界面。

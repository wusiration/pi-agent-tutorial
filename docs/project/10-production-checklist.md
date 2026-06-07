# 10 生产检查清单

> 教学项目的代码是为了"理解原理"，但生产环境需要考虑安全、监控、部署、测试等更多维度。本章提供一份上线前的检查清单。

## 总览

```
┌─────────────────────────────────────────────────────────────┐
│                     生产检查清单                              │
├─────────────┬─────────────┬─────────────┬───────────────────┤
│   安全 🔒   │   监控 📊   │   部署 🚀   │    测试 ✅        │
├─────────────┼─────────────┼─────────────┼───────────────────┤
│ • API Key   │ • 健康检查  │ • Docker    │ • 单元测试        │
│   管理      │ • 指标采集  │ • 环境变量  │ • 集成测试        │
│ • 输入校验  │ • 日志分级  │ • 进程管理  │ • E2E 测试        │
│ • 速率限制  │ • 告警通知  │ • 水平扩展  │ • 混沌测试        │
│ • CORS      │ • 链路追踪  │ • 数据库    │ • 负载测试        │
└─────────────┴─────────────┴─────────────┴───────────────────┘
```

---

## 一、安全 🔒

### 1.1 API Key 管理

**教学版做法**（不安全）：

```ts
// ❌ 不要这样做
const apiKey = 'sk-xxxxxxxxxxxxxxxxxxxxxxxx' // 硬编码在代码中
```

**生产做法**：

```ts
// ✅ 环境变量 + 校验
const apiKey = process.env.OPENAI_API_KEY
if (!apiKey) {
  throw new Error('OPENAI_API_KEY is required')
}

// ✅ 使用密钥管理服务（AWS Secrets Manager / Azure Key Vault）
import { SecretsManager } from '@aws-sdk/client-secrets-manager'
const secret = await secretsManager.getSecretValue({ SecretId: 'llm-api-key' })
```

**检查项**：

- [ ] 没有密钥硬编码在代码仓库中
- [ ] `.env` 文件已加入 `.gitignore`
- [ ] 生产环境使用密钥管理服务或 CI/CD Secret
- [ ] 密钥有轮换机制（定期更换）
- [ ] 不同环境使用不同密钥（dev/staging/prod）

### 1.2 输入校验

Agent 接收用户输入，可能通过工具执行影响系统。必须严格校验：

```ts
// ✅ 使用 TypeBox 校验工具参数
import { Value } from '@sinclair/typebox/value'

function validateToolCall(tool: AgentTool, args: unknown) {
  const valid = Value.Check(tool.parameters, args)
  if (!valid) {
    const errors = [...Value.Errors(tool.parameters, args)]
    throw new Error(`参数校验失败: ${errors.map((e) => e.message).join(', ')}`)
  }
}

// ✅ 限制用户消息长度
const MAX_MESSAGE_LENGTH = 4000
if (userMessage.length > MAX_MESSAGE_LENGTH) {
  throw new Error(`消息过长，最大支持 ${MAX_MESSAGE_LENGTH} 字符`)
}

// ✅ 文件路径白名单（防止目录遍历）
const ALLOWED_PATHS = ['/data/uploads/', '/tmp/']
function sanitizePath(inputPath: string): string {
  const resolved = path.resolve(inputPath)
  const allowed = ALLOWED_PATHS.some((p) => resolved.startsWith(path.resolve(p)))
  if (!allowed) {
    throw new Error('访问路径不在允许范围内')
  }
  return resolved
}
```

**检查项**：

- [ ] 所有工具参数都经过 Schema 校验
- [ ] 用户输入有长度限制
- [ ] 文件操作有路径白名单
- [ ] 敏感操作（删除、修改）需要二次确认

### 1.3 速率限制

防止滥用和意外高额账单：

```ts
// ✅ 使用 fastify-rate-limit
import rateLimit from '@fastify/rate-limit'

app.register(rateLimit, {
  max: 100,          // 每个 IP 最多 100 请求
  timeWindow: '1 minute',
  keyGenerator: (req) => req.ip,
})

// ✅ LLM 调用级别的限流
import { RateLimiter } from 'limiter'
const llmLimiter = new RateLimiter({ tokensPerInterval: 10, interval: 'minute' })

async function callLLMWithLimit(options: ChatOptions) {
  const hasToken = await llmLimiter.removeTokens(1)
  if (!hasToken) {
    throw new Error('LLM 调用过于频繁，请稍后再试')
  }
  return callLLM(options)
}
```

**检查项**：

- [ ] HTTP API 有速率限制
- [ ] LLM 调用有速率限制
- [ ] 按用户 ID 限流（不只是 IP）
- [ ] 超出限制时返回 429 状态码

### 1.4 CORS 与 CSP

```ts
// ✅ 严格配置 CORS
app.register(cors, {
  origin: process.env.ALLOWED_ORIGINS?.split(',') || false,
  credentials: true,
  methods: ['GET', 'POST'],
})

// ✅ 前端 CSP
<meta http-equiv="Content-Security-Policy"
  content="default-src 'self'; connect-src 'self' https://api.yoursite.com;">
```

---

## 二、监控 📊

### 2.1 健康检查

```ts
// ✅ 健康检查端点
app.get('/health', async () => {
  const checks = {
    server: true,
    llm: await checkLLMConnection(),
    database: await checkDatabase(),
  }

  const healthy = Object.values(checks).every(Boolean)
  return {
    status: healthy ? 'ok' : 'degraded',
    checks,
    timestamp: new Date().toISOString(),
  }
})
```

### 2.2 关键指标

| 指标 | 类型 | 说明 |
|------|------|------|
| `llm_requests_total` | Counter | LLM 调用总次数 |
| `llm_request_duration_seconds` | Histogram | LLM 调用耗时分布 |
| `llm_tokens_input` | Counter | 输入 token 数 |
| `llm_tokens_output` | Counter | 输出 token 数 |
| `agent_turns_total` | Counter | Agent turn 次数 |
| `agent_errors_total` | Counter | Agent 错误次数（按类型） |
| `active_sessions` | Gauge | 当前活跃会话数 |
| `sse_connections` | Gauge | 当前 SSE 连接数 |

```ts
// ✅ 使用 prom-client
import { Counter, Histogram, register } from 'prom-client'

const llmDuration = new Histogram({
  name: 'llm_request_duration_seconds',
  help: 'LLM request duration',
  labelNames: ['provider', 'model'],
  buckets: [0.1, 0.5, 1, 2, 5, 10, 30],
})

// 在 LLM 调用处埋点
const end = llmDuration.startTimer({ provider: 'openai', model: 'gpt-4o' })
try {
  const result = await callLLM(options)
  end()
  return result
} catch (error) {
  end({ error: 'true' })
  throw error
}

// 暴露 metrics 端点
app.get('/metrics', async (req, res) => {
  res.header('Content-Type', register.contentType)
  res.send(await register.metrics())
})
```

### 2.3 日志分级

```ts
// ✅ 结构化日志
import pino from 'pino'

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  transport: process.env.NODE_ENV === 'development'
    ? { target: 'pino-pretty' }
    : undefined,
})

// 使用
logger.info({ userId, sessionId }, 'Agent started')
logger.warn({ toolName, args }, 'Tool execution slow')
logger.error({ err, turn, messageCount }, 'Agent loop failed')
```

**日志应该包含**：
- 时间戳（ISO 8601）
- 日志级别（DEBUG/INFO/WARN/ERROR）
- 请求 ID（用于链路追踪）
- 用户 ID（脱敏处理）
- 相关上下文（sessionId、turn、toolName）

### 2.4 告警规则

```yaml
# Prometheus 告警规则示例
groups:
  - name: agent-alerts
    rules:
      - alert: LLMErrorRateHigh
        expr: rate(llm_errors_total[5m]) / rate(llm_requests_total[5m]) > 0.1
        for: 5m
        annotations:
          summary: "LLM 错误率超过 10%"

      - alert: AgentLoopStuck
        expr: agent_turns_total > 50
        for: 1m
        annotations:
          summary: "Agent 可能陷入死循环"

      - alert: HighLatency
        expr: histogram_quantile(0.95, llm_request_duration_seconds) > 30
        for: 5m
        annotations:
          summary: "LLM P95 延迟超过 30 秒"
```

---

## 三、部署 🚀

### 3.1 Docker 化

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY package*.json ./
RUN npm ci
COPY . .
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY package.json ./

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=3s \
  CMD node -e "require('http').get('http://localhost:3000/health', (r) => r.statusCode === 200 ? process.exit(0) : process.exit(1))"

CMD ["node", "dist/main.js"]
```

### 3.2 Docker Compose（开发/测试）

```yaml
# docker-compose.yml
version: '3.8'
services:
  backend:
    build: ./backend
    ports:
      - "3000:3000"
    environment:
      - NODE_ENV=production
      - LLM_PROVIDER=openai
      - LLM_API_KEY=${LLM_API_KEY}
      - REDIS_URL=redis://redis:6379
    depends_on:
      - redis
    restart: unless-stopped

  frontend:
    build: ./frontend
    ports:
      - "80:80"
    depends_on:
      - backend

  redis:
    image: redis:7-alpine
    volumes:
      - redis-data:/data
    restart: unless-stopped

volumes:
  redis-data:
```

### 3.3 环境变量清单

| 变量 | 必填 | 默认值 | 说明 |
|------|------|--------|------|
| `NODE_ENV` | ✅ | - | `development` / `production` |
| `PORT` | ❌ | 3000 | 服务端口 |
| `LOG_LEVEL` | ❌ | info | 日志级别 |
| `LLM_PROVIDER` | ✅ | - | 提供商 ID |
| `LLM_API_KEY` | ✅ | - | API 密钥 |
| `LLM_BASE_URL` | ❌ | - | 自定义 API 地址 |
| `LLM_MODEL` | ❌ | - | 默认模型 |
| `MAX_TURNS` | ❌ | 10 | Agent 最大轮次 |
| `MAX_MESSAGE_LENGTH` | ❌ | 4000 | 最大消息长度 |
| `RATE_LIMIT_RPM` | ❌ | 60 | 每分钟请求限制 |
| `CORS_ORIGINS` | ❌ | - | 允许的源，逗号分隔 |
| `REDIS_URL` | ❌ | - | Redis 连接地址 |

### 3.4 进程管理

```json
// ecosystem.config.js (PM2)
module.exports = {
  apps: [{
    name: 'pi-agent-backend',
    script: './dist/main.js',
    instances: 'max',        // 使用所有 CPU 核心
    exec_mode: 'cluster',
    env: {
      NODE_ENV: 'production',
    },
    max_memory_restart: '1G',
    restart_delay: 3000,
    log_date_format: 'YYYY-MM-DD HH:mm:ss Z',
  }],
}
```

---

## 四、测试 ✅

### 4.1 单元测试

```ts
// src/tools/calculator.test.ts
import { describe, it, expect } from 'vitest'
import { calculatorTool } from './calculator'

describe('calculatorTool', () => {
  it('should add two numbers', async () => {
    const result = await calculatorTool.execute('call-1', {
      expression: '2 + 3',
    })
    expect(result.content[0].text).toBe('5')
  })

  it('should handle division by zero', async () => {
    await expect(
      calculatorTool.execute('call-2', { expression: '1 / 0' }),
    ).rejects.toThrow()
  })
})
```

### 4.2 集成测试

```ts
// test/agent.integration.test.ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildApp } from '../src/app'

describe('Agent API', () => {
  let app: FastifyInstance

  beforeAll(async () => {
    app = await buildApp({ useMockLLM: true })
    await app.ready()
  })

  afterAll(async () => {
    await app.close()
  })

  it('should handle a complete conversation', async () => {
    const response = await app.inject({
      method: 'POST',
      url: '/api/chat',
      payload: {
        message: 'What is 2 + 2?',
        sessionId: 'test-session',
      },
    })

    expect(response.statusCode).toBe(200)
    const events = parseSSE(response.payload)
    expect(events.some((e) => e.type === 'agent_end')).toBe(true)
  })
})
```

### 4.3 E2E 测试

```ts
// e2e/chat.spec.ts
import { test, expect } from '@playwright/test'

test('user can send a message and receive response', async ({ page }) => {
  await page.goto('http://localhost:5173')

  await page.fill('[data-testid="chat-input"]', 'Hello, Agent!')
  await page.click('[data-testid="send-button"]')

  await expect(page.locator('[data-testid="message-assistant"]')).toBeVisible()
  await expect(page.locator('[data-testid="message-assistant"]')).not.toHaveText('')
})
```

### 4.4 混沌测试

模拟各种异常情况：

```ts
// test/chaos.test.ts
describe('Chaos scenarios', () => {
  it('should handle LLM timeout', async () => {
    // 模拟 LLM 5 秒无响应
  })

  it('should handle SSE client disconnect', async () => {
    // 客户端中途断开连接
  })

  it('should handle malformed tool arguments', async () => {
    // LLM 返回了不符合 Schema 的参数
  })

  it('should handle rapid steering messages', async () => {
    // 用户快速发送多条 steering
  })
})
```

---

## 五、错误处理与恢复

### 5.1 错误分类

| 错误类型 | 示例 | 处理方式 |
|---------|------|---------|
| **用户错误** | 消息过长、参数无效 | 返回 400，友好提示 |
| **LLM 错误** | API 限流、模型不可用 | 重试 3 次，失败则返回 503 |
| **工具错误** | 文件不存在、网络超时 | 返回 `isError: true`，让 LLM 决定 |
| **系统错误** | 内存不足、磁盘满 | 记录日志，返回 500，触发告警 |
| **安全错误** | 路径遍历、注入尝试 | 记录日志，返回 403，可能封禁用户 |

### 5.2 重试策略

```ts
async function callLLMWithRetry(options: ChatOptions, maxRetries = 3) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await callLLM(options)
    } catch (error) {
      const isRetryable = error.status === 429 || error.status >= 500
      if (!isRetryable || i === maxRetries - 1) throw error

      const delay = Math.pow(2, i) * 1000 // 指数退避
      await sleep(delay)
    }
  }
}
```

### 5.3 优雅降级

```ts
// LLM 不可用时切换到 Mock 模式
async function getLLMResponse(options: ChatOptions) {
  try {
    return await callLLM(options)
  } catch (error) {
    logger.warn('LLM unavailable, falling back to mock')
    return callMockLLM(options)
  }
}
```

---

## 六、上线前最终检查

### 安全

- [ ] 没有密钥硬编码
- [ ] 输入校验覆盖所有入口
- [ ] 速率限制已启用
- [ ] CORS 配置正确
- [ ] 敏感操作有权限检查

### 监控

- [ ] `/health` 端点可用
- [ ] `/metrics` 端点暴露关键指标
- [ ] 日志分级正确
- [ ] 告警规则已配置
- [ ] 错误日志能定位到具体代码位置

### 部署

- [ ] Dockerfile 多阶段构建
- [ ] 环境变量文档完整
- [ ] 健康检查配置正确
- [ ] 进程管理（PM2/Docker Swarm/K8s）已配置
- [ ] 数据库/缓存连接有重试机制

### 测试

- [ ] 单元测试覆盖率 > 60%
- [ ] 集成测试覆盖核心流程
- [ ] E2E 测试覆盖关键用户路径
- [ ] 性能测试确认能承受预期负载
- [ ] 混沌测试通过

---

> 📋 这份清单不是一次性任务，而是持续迭代的过程。建议每季度回顾一次，根据实际运行数据调整阈值和策略。

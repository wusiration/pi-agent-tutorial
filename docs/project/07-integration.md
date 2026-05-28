# 07 联调与运行

> 前后端代码都已经写好，这一章确保它们能协同工作，并提供完整的运行指南。

## 完整启动流程

### 1. 环境准备

```bash
# 克隆项目（假设你已经有了）
cd pi-agent-playground

# 安装后端依赖
cd backend
npm install

# 安装前端依赖
cd ../frontend
npm install
```

### 2. 配置环境变量

```bash
# backend/.env（新建）
OPENAI_API_KEY=sk-your-key-here
OPENAI_BASE_URL=https://api.openai.com/v1
PORT=3000
```

如果不配置 `OPENAI_API_KEY`，可以使用 Mock 模式运行。

### 3. 启动服务

需要两个终端：

**终端 1 - 后端：**

```bash
cd backend
npm run dev
```

预期输出：

```
Server running at http://localhost:3000
```

**终端 2 - 前端：**

```bash
cd frontend
npm run dev
```

预期输出：

```
  VITE v5.x  ready in xxx ms
  ➜  Local:   http://localhost:5173/
  ➜  Network: use --host to expose
```

### 4. 验证联调

打开浏览器访问 http://localhost:5173

#### 测试 1：Mock 模式对话

1. 确保"Mock 模式"开关已打开
2. 输入：`Hello`
3. 预期：AI 回复 "Mock response to: \"Hello\""，逐字出现

#### 测试 2：工具调用

1. 输入：`What's the weather in Beijing?`
2. 预期：
   - 显示 "🔧 weather 执行中..."
   - 1 秒后显示 "✅ weather 已完成" 和天气结果
   - AI 根据结果生成回复

#### 测试 3：真实 LLM（需要 API key）

1. 关闭"Mock 模式"
2. 输入：`Calculate 123 * 456`
3. 预期：
   - AI 调用 calculator 工具
   - 显示结果 56088
   - AI 确认结果

#### 测试 4：新会话

1. 发送几条消息
2. 点击"新会话"
3. 预期：消息列表清空，`sessionId` 改变
4. 在新会话发送消息，旧会话历史不受影响

#### 测试 5：导出

1. 发送几条消息
2. 点击"导出"（需要在 UI 添加按钮，或直接用 API）
3. 预期：下载 JSON 文件，包含完整消息历史

## 常见问题排查

### 问题 1：前端无法连接后端

**现象**：发送消息后一直转圈，没有响应

**排查**：

```bash
# 检查后端是否运行
curl http://localhost:3000/api/health
# 应该返回 {"status":"ok"}

# 检查前端代理配置
cat frontend/vite.config.ts
# 确认 proxy: { '/api': { target: 'http://localhost:3000' } }
```

**解决**：确保后端端口和前端代理目标一致。

### 问题 2：SSE 事件不触发

**现象**：后端收到请求，但前端没有收到事件

**排查**：

```bash
# 直接用 curl 测试 SSE
curl -N -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"test","useMock":true}'

# 应该看到 data: {...} 流式输出
```

**可能原因**：
- 响应头没有 `Content-Type: text/event-stream`
- 事件格式错误（缺少 `data: ` 前缀或 `\n\n` 结尾）
- 前端解析逻辑有误

### 问题 3：OpenAI API 报错

**现象**：关闭 Mock 模式后报错

**排查**：

```bash
# 检查环境变量
echo $OPENAI_API_KEY

# 测试 API 连通性
curl https://api.openai.com/v1/models \
  -H "Authorization: Bearer $OPENAI_API_KEY"
```

**常见错误**：
- `401`：API key 无效或过期
- `429`：请求频率超限
- `500`：OpenAI 服务端错误

### 问题 4：工具不执行

**现象**：AI 回复说"我会帮你查"，但没有调用工具

**排查**：
- 检查 `systemPrompt` 是否明确告诉 AI 可以使用工具
- 检查工具 `description` 是否清晰
- 在 `openai-client.ts` 中确认 `tools` 参数已正确传递
- 某些模型（如 gpt-4o-mini）可能需要更强的提示才会调用工具

## 性能优化建议

### 1. 后端优化

```ts
// 使用 Fastify 的日志级别控制
const app = Fastify({ logger: { level: 'warn' } })

// 添加请求限流
import rateLimit from '@fastify/rate-limit'
await app.register(rateLimit, { max: 100, timeWindow: '1 minute' })
```

### 2. 前端优化

```tsx
// 使用 useMemo 避免不必要的重渲染
const messageList = useMemo(() => messages.map(...), [messages])

// 虚拟滚动（消息很多时）
import { Virtuoso } from 'react-virtuoso'
```

### 3. 网络优化

```ts
// 后端启用 gzip
import compress from '@fastify/compress'
await app.register(compress)

// 前端启用 HTTP/2（生产环境）
```

## 部署到生产

### Docker 部署

```dockerfile
# Dockerfile
FROM node:20-alpine AS builder
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci
COPY backend/ ./
COPY shared/ ../shared/
RUN npm run build

FROM node:20-alpine
WORKDIR /app
COPY --from=builder /app/dist ./dist
COPY --from=builder /app/node_modules ./node_modules
COPY backend/package.json ./
EXPOSE 3000
CMD ["node", "dist/index.js"]
```

### 前端静态部署

```bash
cd frontend
npm run build
# 把 dist/ 目录部署到 Vercel / Netlify / Nginx
```

### 环境变量

生产环境需要设置：

```bash
OPENAI_API_KEY=sk-...
OPENAI_BASE_URL=https://api.openai.com/v1
PORT=3000
NODE_ENV=production
```

## 本章小结

- 启动需要两个服务：后端（port 3000）+ 前端（port 5173）
- Mock 模式无需 API key，适合开发和演示
- 常见问题的排查路径：网络连通 → SSE 格式 → API 认证 → 工具提示词
- 生产部署可以用 Docker + 静态托管

## 下一步

你已经完成了一个可运行的教学版 Agent！接下来可以：
- 阅读 [扩展方向](/project/08-extensions)，了解还能做什么
- 回到 [Demo 章节](/demos/01-hello-stream)，用真实 API key 运行
- 尝试修改代码，添加你自己的工具

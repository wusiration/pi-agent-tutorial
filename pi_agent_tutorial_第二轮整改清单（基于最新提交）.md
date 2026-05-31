# pi-agent-tutorial 第二轮整改清单

> 基于最新提交重新整理。
>
> 本文只保留当前仍值得处理的问题，并将上一轮已经完成的优化单独列出，避免重复修改。
>
> 建议处理原则：先修复会直接影响运行正确性的 P0，再补齐 CI、测试和文档一致性。

---

# 一、当前项目状态概览

最新版本已经完成了一轮明显升级：

- 已新增 `examples/01-manual-loop`；
- 已新增完整 `playground/`；
- 已补充 backend、frontend、shared 目录；
- 已修复 Mock Loop 无限重复工具调用；
- 已修复 OpenAI tool call 参数分片拼接；
- 已补充 AbortSignal 传递；
- 已移除共享 `default` session；
- 已替换不安全 calculator；
- 已增加工具参数校验；
- 已增加请求体校验；
- 已增加 maxTurns 错误事件。

当前项目已经从“教程文档站”升级为“具备可运行工程结构的教学项目”。

下一步重点不再是扩充功能，而是修复新回归、补齐自动化验证，并确保文档描述与真实行为一致。

---

# 二、已完成项

以下问题本轮不再重复处理：

- [x] Mock 模式工具调用重复执行
- [x] Mock 模式固定调用 `tools[0]`
- [x] OpenAI tool call arguments 分片累积
- [x] calculator 移除 `Function()` / 动态执行 JS
- [x] 工具参数基础运行时校验
- [x] API 请求体基础校验
- [x] maxTurns 错误提示
- [x] 新增最小 example
- [x] 新增完整 playground
- [x] 基础 AbortSignal 贯通
- [x] 移除共享 `'default'` session

---

# 三、P0：必须优先修复的正确性问题

## 1. 修复 `message_start` 缺少 `messageId` 的问题

### 状态

- [ ] 待处理

### 问题现象

当前共享事件类型中：

```ts
type AgentEvent =
  | { type: 'message_start'; message: Message }
  | { type: 'message_update'; messageId: string; delta: string }
  | { type: 'message_end'; messageId: string; message: Message }
```

`message_start` 没有携带 `messageId`，但 `message_update` 和 `message_end` 有。

前端为了关联消息，只能使用 `timestamp` 自行推导：

```ts
const msgId = `msg-${event.message.timestamp}`
assistantMessageIds.current.set(msgId, id)
```

但后端生成真实 `messageId` 的时间点和 assistant message 的 `timestamp` 不一定相同。

在 Mock 模式下，通常会先生成 `messageId`，延迟一段时间后再创建 assistant message，因此这两个值很容易不同。

### 可能表现

```text
message_start
→ 前端创建空白 assistant 气泡
→ message_update 查不到映射
→ delta 被丢弃
→ 页面只显示空白消息
```

### 修改建议

统一事件结构：

```ts
type AgentEvent =
  | {
      type: 'message_start'
      messageId: string
      message: Message
    }
  | {
      type: 'message_update'
      messageId: string
      delta: string
    }
  | {
      type: 'message_end'
      messageId: string
      message: Message
    }
```

后端必须在三种事件中复用同一个 ID：

```ts
onEvent({
  type: 'message_start',
  messageId,
  message: assistantMessage,
})

onEvent({
  type: 'message_update',
  messageId,
  delta,
})

onEvent({
  type: 'message_end',
  messageId,
  message: assistantMessage,
})
```

前端直接使用事件里的 `messageId`：

```ts
assistantMessageIds.current.set(event.messageId, uiMessageId)
```

不要再通过 timestamp 推导。

### 验收标准

- [ ] Mock 普通文本可以逐字显示；
- [ ] Mock calculator 工具调用后，最终回答可以正常显示；
- [ ] Mock weather 工具调用后，最终回答可以正常显示；
- [ ] 真实 OpenAI 文本流可以正常显示；
- [ ] 中途插入 tool card 后，文本仍然写入正确气泡；
- [ ] 不出现空白 assistant 气泡。

### 建议测试

```text
1. hello
2. calculate 2 + 2
3. weather in Beijing
4. search TypeScript
```

---

## 2. 合并 `SessionManager` 和 `agents Map`

### 状态

- [ ] 待处理

### 问题现象

当前路由层同时维护：

```ts
const sessionManager = new SessionManager(...)
const agents = new Map<string, Agent>()
```

`SessionManager` 会清理自己的 session 数据，但真实消息历史保存在 `Agent.context.messages` 中，且 Agent 仍然存在于 `agents Map`。

如果清理逻辑只删除 `SessionManager.sessions`，没有删除 `agents Map`，则 TTL 和最大 session 数限制没有真正释放 Agent。

### 风险

- Agent 历史长期占用内存；
- `/api/stats` 和真实 Agent 数量不一致；
- session 已经过期，但 Agent 仍然可能被访问；
- 长时间运行后内存持续增长。

### 修改建议

不要维护两个独立状态源。

建议让 `SessionManager` 直接持有 Agent：

```ts
interface SessionEntry {
  agent: Agent
  createdAt: number
  lastAccessedAt: number
}

class SessionManager {
  private sessions = new Map<string, SessionEntry>()
}
```

增加：

```ts
createAgent(sessionId: string): Agent
getAgent(sessionId: string): Agent | undefined
deleteSession(sessionId: string): void
cleanupExpiredSessions(): void
```

删除独立的：

```ts
const agents = new Map<string, Agent>()
```

清理时确保释放 Agent：

```ts
deleteSession(sessionId: string) {
  const session = this.sessions.get(sessionId)
  session?.agent.abort?.()
  this.sessions.delete(sessionId)
}
```

### 验收标准

- [ ] TTL 到期后，session 和 Agent 同时删除；
- [ ] `/api/history` 对过期 session 返回 404；
- [ ] `/api/export` 对过期 session 返回 404；
- [ ] `/api/stats` 与真实 Agent 数量一致；
- [ ] 创建超过 maxSessions 数量后，最旧 session 被真正释放；
- [ ] 长时间测试后内存不会持续增长。

### 建议测试

```text
1. 创建 3 个 session，确认 stats = 3
2. 设置 maxSessions = 2，再创建第 3 个 session
3. 确认最旧 session 无法继续访问
4. 设置 TTL = 1 秒，等待后再请求 history
5. 确认返回 404
```

---

## 3. 修复 frontend TypeScript 构建风险

### 状态

- [ ] 待处理

### 问题现象

前端 `useAgent.ts` 中存在未使用类型导入：

```ts
import type { AgentEvent, Message } from '../../../shared/types'
```

如果 `Message` 没有使用，而 `tsconfig.json` 开启：

```json
{
  "noUnusedLocals": true,
  "noUnusedParameters": true
}
```

则执行：

```bash
npm run build
```

可能直接失败。

### 修改建议

删除未使用导入：

```ts
import type { AgentEvent } from '../../../shared/types'
```

然后完整执行前端构建，逐项清理所有 TypeScript 错误。

### 验收标准

```bash
cd playground/frontend
npm ci
npm run build
```

必须完整通过。

- [ ] 无未使用变量错误；
- [ ] 无类型错误；
- [ ] Vite 构建成功；
- [ ] 产物目录正常生成。

---

# 四、P1：运行稳定性与 API 完整性

## 4. CI 增加 playground 构建和测试

### 状态

- [ ] 待处理

### 问题现象

当前 GitHub Actions 主要验证：

```bash
npm ci
npm run docs:build
```

这只能证明 VitePress 文档可构建，不能证明：

```text
backend 可以编译
backend 单测通过
frontend 可以编译
example 可以运行
playground 可以启动
```

### 修改建议

新增 quality job：

```yaml
quality:
  runs-on: ubuntu-latest

  steps:
    - uses: actions/checkout@v4

    - uses: actions/setup-node@v4
      with:
        node-version: 20

    - name: Build backend
      working-directory: playground/backend
      run: |
        npm ci
        npm run build
        npm test -- --run

    - name: Build frontend
      working-directory: playground/frontend
      run: |
        npm ci
        npm run build

    - name: Run minimal example
      working-directory: examples/01-manual-loop
      run: |
        npm ci
        npm run build --if-present
```

让部署依赖 quality：

```yaml
deploy:
  needs: [build, quality]
```

### 验收标准

- [ ] backend build 失败时 CI 失败；
- [ ] backend test 失败时 CI 失败；
- [ ] frontend build 失败时 CI 失败；
- [ ] docs build 失败时 CI 失败；
- [ ] CI 全绿后才允许部署。

---

## 5. 验证 backend 构建后的启动路径

### 状态

- [ ] 待处理

### 问题现象

backend `tsconfig.json` 同时 include：

```json
{
  "include": ["src/**/*", "../shared/**/*"],
  "outDir": "./dist"
}
```

由于源码来自多个目录，如果没有明确设置 `rootDir`，编译后的输出结构可能不是：

```text
dist/index.js
```

而可能是：

```text
dist/backend/src/index.js
dist/shared/types.js
```

但 package.json 中如果写的是：

```json
{
  "start": "node dist/index.js"
}
```

启动可能失败。

### 验证命令

```bash
cd playground/backend
npm ci
npm run build
find dist -type f | sort
npm run start
```

### 推荐方案

长期建议把 shared 变成独立 workspace package：

```text
playground/
  backend/
  frontend/
  shared/
    package.json
    src/
      types.ts
```

backend 和 frontend 统一使用：

```ts
import type { AgentEvent } from '@pi-agent/shared'
```

### 验收标准

- [ ] `npm run build` 通过；
- [ ] `npm run start` 可以启动；
- [ ] 启动路径与真实 dist 文件一致；
- [ ] shared 类型引用稳定。

---

## 6. 清理 Mock `delay()` 的 abort listener

### 状态

- [ ] 待处理

### 问题现象

Mock 流式输出逐字调用：

```ts
await delay(30, signal)
```

每一次 delay 都注册 abort listener。如果定时器正常结束时没有移除 listener，同一个 signal 会积累大量监听器。

### 风险

- 长文本输出时 listener 数量增加；
- Node 可能产生监听器过多警告；
- 不必要的内存占用；
- 中止时触发大量无效回调。

### 修改建议

```ts
function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }

    const onAbort = () => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    }

    const timer = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort)
      resolve()
    }, ms)

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
```

### 验收标准

- [ ] 正常输出完成后不会残留 listener；
- [ ] 中止时 Promise 正确 reject；
- [ ] 长文本输出时不会出现监听器警告；
- [ ] abort 后不会继续输出字符。

---

## 7. `/api/chat` 自动创建 session 时返回 sessionId

### 状态

- [ ] 待处理

### 问题现象

如果 `/api/chat` 在没有收到 `sessionId` 时自动生成新 session：

```ts
if (!sessionId) {
  sessionId = createSessionId()
}
```

但没有把 sessionId 返回给调用方，那么直接使用 API 的客户端无法继续同一会话。

### 修改建议

方案 A：强制客户端先创建 session。

```text
POST /api/sessions
→ 返回 sessionId
POST /api/chat
→ 必须携带 sessionId
```

方案 B：自动创建时通过 SSE 发送：

```ts
type AgentEvent =
  | {
      type: 'session_created'
      sessionId: string
    }
  | ...
```

后端：

```ts
sse.send({
  type: 'session_created',
  sessionId,
})
```

### 推荐选择

优先推荐方案 A。API 语义更清晰，前端逻辑也更容易维护。

### 验收标准

- [ ] 不传 sessionId 时，API 行为明确；
- [ ] 客户端可以拿到服务端生成的 sessionId；
- [ ] 可以连续进行多轮对话；
- [ ] README 有 API 调用说明。

---

# 五、P2：代码设计与长期维护

## 8. 使用 TypeBox Value 或 AJV 替代手写参数校验

### 状态

- [ ] 待处理

### 当前情况

当前手写校验已经覆盖：

```text
required
string
number
boolean
minLength
maxLength
minimum
maximum
```

但尚未完整覆盖：

```text
数组
嵌套对象
enum
pattern
additionalProperties
联合类型
format
```

### 修改建议

既然项目已经使用 TypeBox，优先考虑：

```ts
import { Value } from '@sinclair/typebox/value'
```

参考：

```ts
if (!Value.Check(tool.parameters, args)) {
  const errors = [...Value.Errors(tool.parameters, args)]

  return {
    type: 'toolResult',
    toolCallId,
    toolName,
    isError: true,
    content: JSON.stringify(errors),
  }
}
```

### 验收标准

- [ ] 嵌套对象可以校验；
- [ ] 数组可以校验；
- [ ] enum 可以校验；
- [ ] 错误结果结构清晰；
- [ ] 模型可以根据错误进行自我修正。

---

## 9. sessionId 改用 `crypto.randomUUID()`

### 状态

- [ ] 待处理

### 问题现象

当前如果使用：

```ts
`sess-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`
```

教学阶段可以运行，但不够规范。

### 修改建议

```ts
import { randomUUID } from 'node:crypto'

const sessionId = `sess-${randomUUID()}`
```

### 验收标准

- [ ] sessionId 唯一；
- [ ] 不依赖 `Math.random()`；
- [ ] 测试用例可以稳定生成 sessionId。

---

## 10. 收敛 `agent_error` 和 `agent_end` 终态语义

### 状态

- [ ] 待处理

### 问题现象

如果失败时先发：

```text
agent_error
```

随后又发：

```text
agent_end
```

而 API 收到任一终态事件都会关闭 SSE，则客户端通常只能收到其中一个事件。

### 推荐设计

方案 A：成功和失败分别使用不同终态事件。

```text
成功：agent_end
失败：agent_error
中止：agent_aborted
```

方案 B：统一为：

```ts
{
  type: 'agent_end',
  status: 'success' | 'error' | 'aborted',
  error?: {
    code: string
    message: string
  }
}
```

### 推荐选择

推荐方案 B，终态更统一。

### 验收标准

- [ ] 每次请求只产生一个终态；
- [ ] 成功、失败、中止三种状态可区分；
- [ ] 前端不会因为提前关闭 SSE 丢失终态；
- [ ] 日志中的结束原因一致。

---

## 11. README 精确描述 examples 覆盖范围

### 状态

- [ ] 待处理

### 问题现象

当前仓库已经新增：

```text
examples/01-manual-loop
playground/
```

但如果 README 仍然描述：

```text
5 个独立可运行 Demo
```

而实际独立落盘的 example 只有一个，则读者会产生误解。

### 修改建议

二选一：

#### 方案 A：补齐 examples

```text
examples/
  01-manual-loop/
  02-tool-calls/
  03-multi-tools/
  04-event-stream/
  05-steering-queue/
```

#### 方案 B：修改 README

```md
文档中包含 5 个渐进式 Demo，其中 `examples/01-manual-loop` 已提供独立可运行版本。完整前后端示例位于 `playground/`。
```

### 验收标准

- [ ] README 描述与真实目录一致；
- [ ] 不存在无法执行的 `cd examples/02-*` 命令；
- [ ] 新手可以找到正确的入门路径。

---

# 六、推荐 CI 配置结构

建议拆分：

```text
quality
build-docs
deploy
```

参考：

```yaml
name: CI and Deploy

on:
  push:
    branches: [main]
  pull_request:
    branches: [main]

jobs:
  quality:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - name: Backend build and test
        working-directory: playground/backend
        run: |
          npm ci
          npm run build
          npm test -- --run

      - name: Frontend build
        working-directory: playground/frontend
        run: |
          npm ci
          npm run build

      - name: Example build
        working-directory: examples/01-manual-loop
        run: |
          npm ci
          npm run build --if-present

  build-docs:
    runs-on: ubuntu-latest

    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: 20

      - run: npm ci
      - run: npm run docs:build

  deploy:
    if: github.event_name == 'push'
    needs: [quality, build-docs]
    runs-on: ubuntu-latest

    steps:
      - run: echo 'Deploy GitHub Pages here'
```

---

# 七、推荐处理顺序

## 第一批：马上修复

- [ ] 1. `message_start` 增加 `messageId`
- [ ] 2. 合并 `SessionManager` 与 `agents Map`
- [ ] 3. 修复 frontend TypeScript build

## 第二批：建立自动验证

- [ ] 4. CI 增加 backend build/test
- [ ] 4. CI 增加 frontend build
- [ ] 4. CI 增加 example build
- [ ] 5. 验证 backend dist 输出和 start 路径

## 第三批：提升运行稳定性

- [ ] 6. 清理 Mock delay abort listener
- [ ] 7. 明确 `/api/chat` 的 session 创建语义
- [ ] 10. 收敛 agent 终态事件

## 第四批：提升工程规范

- [ ] 8. TypeBox Value / AJV 完整校验
- [ ] 9. sessionId 使用 randomUUID
- [ ] 11. README 精确描述 examples 覆盖范围

---

# 八、验收命令

修改完成后，要求真实执行并保存输出。

## 文档站

```bash
npm ci
npm run docs:build
```

## 最小 example

```bash
cd examples/01-manual-loop
npm ci
npm run build --if-present
npm run start
```

## Backend

```bash
cd playground/backend
npm ci
npm run build
npm test -- --run
find dist -type f | sort
npm run start
```

## Frontend

```bash
cd playground/frontend
npm ci
npm run build
```

---

# 九、手工验收清单

## 流式消息

- [ ] Mock 普通消息逐字显示；
- [ ] 不出现空白 assistant 气泡；
- [ ] calculator 工具执行后，最终消息正常显示；
- [ ] weather 工具执行后，最终消息正常显示；
- [ ] tool card 插入后，文本仍写入正确消息。

## Session

- [ ] 两个浏览器窗口获得不同 sessionId；
- [ ] 两个窗口历史完全隔离；
- [ ] TTL 到期后 session 无法继续访问；
- [ ] 达到 maxSessions 后，最旧 session 被释放；
- [ ] stats 数量与真实会话数量一致。

## Abort

- [ ] 正在输出时关闭页面，后端停止输出；
- [ ] 长耗时工具可以被中止；
- [ ] abort 不会显示成普通系统异常；
- [ ] 不出现 listener 过多警告。

## 构建

- [ ] docs build 成功；
- [ ] backend build 成功；
- [ ] backend start 成功；
- [ ] backend tests 成功；
- [ ] frontend build 成功；
- [ ] example 可运行。

---

# 十、处理记录模板

```md
## 修改项

- 编号：
- 问题：
- 修改文件：
- Commit：
- 修改说明：
- 测试命令：
- 测试输出：
- 是否完成：
- 后续事项：
```

---

# 十一、最终目标

本轮完成后，项目应达到：

```text
核心流式消息不丢失
Session 生命周期真实有效
Frontend / Backend 均可构建
CI 可以阻止回归
Abort 行为稳定
API 会话语义清晰
README 与真实目录一致
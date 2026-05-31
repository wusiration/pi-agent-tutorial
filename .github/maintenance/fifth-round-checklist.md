# pi-agent-tutorial 第五轮运行时收尾整改任务单

> 基于最新公开提交 `1628599e6e2b02b7234c794ff35a69cfa09a3a25` 审查。
>
> 目标：完成最后一轮运行时收尾，重点修复上下文裁剪、并发请求、reset 竞态、Abort 生命周期、前端 SSE 边界和最小示例逻辑。
>
> 本轮不建议继续扩充功能，优先关闭已定位的边界问题并补齐测试。

---

# 一、当前版本已完成的改进

最新版本已经完成上一轮多数整改：

- [x] `maxTurns` 第 10 轮正常结束不再误判为超限
- [x] OpenAI 流式解码复用单个 `TextDecoder`
- [x] OpenAI 流结束时执行 `decoder.decode()` flush
- [x] tool call 前的文本内容保留在 assistant message 中
- [x] `/api/chat` 对不存在的 sessionId 返回 404
- [x] `SessionManager` 直接持有 Agent
- [x] Fastify `onClose` 调用 `sessionManager.dispose()`
- [x] cleanup timer 调用 `unref()`
- [x] 前端增加基础 `ensureOk()`
- [x] `message_end` 后清理 assistant messageId 映射
- [x] CI 增加 backend build/test、frontend build、example typecheck 和 docs build
- [x] example 增加 typecheck 脚本

当前项目已经进入“运行时边界收尾”阶段。

---

# 二、P0：优先修复的运行时问题

## 1. `maxMessages` 对普通聊天仍然不生效

### 状态

- [ ] 待处理

### 问题描述

当前消息裁剪逻辑仅在工具调用执行完成后触发：

```ts
emit({ type: 'turn_end', message: assistantMsg, toolResults })

if (config.maxMessages && context.messages.length > config.maxMessages) {
  context.messages = trimMessagesByTurns(context.messages, config.maxMessages)
}
```

但是普通文本回复在没有工具调用时会提前：

```ts
if (toolCalls.length === 0) {
  emit({ type: 'turn_end', message: assistantMsg, toolResults: [] })
  completed = true
  break
}
```

因此普通对话不会进入裁剪逻辑。

### 风险

```text
长期普通聊天
→ context.messages 持续增长
→ maxMessages 配置失效
→ 内存持续增长
→ LLM token 成本增加
→ 响应延迟上升
```

### 修改建议

抽取统一裁剪方法：

```ts
function trimContextMessages(
  context: AgentContext,
  maxMessages?: number
): void {
  if (!maxMessages) return
  if (context.messages.length <= maxMessages) return

  context.messages = trimMessagesByTurns(
    context.messages,
    maxMessages
  )
}
```

在所有 turn 完成路径调用：

```ts
if (toolCalls.length === 0) {
  emit({ type: 'turn_end', message: assistantMsg, toolResults: [] })
  trimContextMessages(context, config.maxMessages)
  completed = true
  break
}
```

工具路径也保留调用：

```ts
emit({ type: 'turn_end', message: assistantMsg, toolResults })
trimContextMessages(context, config.maxMessages)
```

### 修改文件

```text
playground/backend/src/core/agent-loop.ts
playground/backend/src/core/agent-loop.test.ts
```

### 必补测试

```ts
it('should trim normal chat messages when maxMessages is exceeded', async () => {
  // 预先插入多轮普通 user / assistant 历史
  // 再执行一次普通文本回复
  // 断言 messages.length <= maxMessages
})
```

### 验收标准

- [ ] 普通聊天超过限制后会裁剪
- [ ] 工具聊天超过限制后会裁剪
- [ ] maxMessages 配置真实生效
- [ ] 测试确实构造出超限场景

---

## 2. `trimMessagesByTurns()` 并没有真正按完整 turn 裁剪

### 状态

- [ ] 待处理

### 问题描述

当前实现：

```ts
const trimmed = messages.slice(-maxMessages)

while (trimmed.length > 0 && trimmed[0]?.role === 'toolResult') {
  trimmed.shift()
}

return trimmed
```

这只能避免第一条消息是孤立 `toolResult`，但不能保证完整 turn。

### 可能出现的异常上下文

```text
assistant(toolCall)
toolResult
assistant(final)
```

或者：

```text
assistant(final)
user
assistant(final)
```

上下文从半轮开始，会影响模型理解。

### 修改目标

按完整 user turn 裁剪，并尽量保证：

```text
user
assistant(toolCall)
toolResult
assistant(final)
```

不会被拆散。

### 推荐实现思路

从后向前保留完整 turn：

```ts
function trimMessagesByTurns(
  messages: Message[],
  maxMessages: number
): Message[] {
  if (messages.length <= maxMessages) return messages

  const turns: Message[][] = []
  let currentTurn: Message[] = []

  for (const message of messages) {
    if (message.role === 'user' && currentTurn.length > 0) {
      turns.push(currentTurn)
      currentTurn = []
    }

    currentTurn.push(message)
  }

  if (currentTurn.length > 0) {
    turns.push(currentTurn)
  }

  const kept: Message[] = []

  for (let i = turns.length - 1; i >= 0; i--) {
    const candidate = turns[i]

    if (kept.length > 0 && kept.length + candidate.length > maxMessages) {
      break
    }

    kept.unshift(...candidate)
  }

  return kept
}
```

可根据项目需求决定：如果最近一轮本身超过限制，是否保留完整最近一轮，允许暂时超过 maxMessages。

### 必补测试

```text
1. 普通多轮对话裁剪后第一条为 user
2. assistant(toolCall) 与 toolResult 不拆散
3. 最近一轮完整保留
4. 混合普通聊天与工具调用时裁剪正确
5. 最近单轮本身超限时行为明确
```

### 验收标准

- [ ] 不保留孤立 toolResult
- [ ] 不从半个 turn 开始
- [ ] 最近 turn 完整保留
- [ ] 裁剪策略有注释说明

---

## 3. 同一 session 并发 `/api/chat` 会覆盖 AbortController

### 状态

- [ ] 待处理

### 问题描述

当前 `/api/chat` 路由先：

```ts
const controller = new AbortController()
agent.setAbortController(controller)
```

再调用：

```ts
await agent.prompt(...)
```

而 `Agent.prompt()` 内部才检查：

```ts
if (this._isStreaming) {
  throw new Error('Agent is already streaming')
}
```

当同一个 session 同时发起两个请求时：

```text
请求 A 正在运行
请求 B 进入路由
→ 请求 B 覆盖 agent.abortController
→ 请求 B 调用 prompt 后才发现 busy
→ 请求 B 抛错
→ 请求 A 的 AbortController 已被替换
```

### 风险

- abort 控制器串线
- reset 或 session delete 时 abort 错请求
- 第二个请求注册的 listener 可能泄漏
- 首个请求的生命周期失控

### 修改建议

在创建 SSE、AbortController 和 listener 之前检查：

```ts
if (agent.state.isStreaming) {
  reply.status(409)
  return {
    error: 'Agent is already streaming',
    code: 'AGENT_BUSY',
  }
}
```

然后再创建：

```ts
const sse = new SSEConnection(reply)
const controller = new AbortController()
agent.setAbortController(controller)
```

同时用 `finally` 统一清理：

```ts
try {
  await agent.prompt(...)
} catch (error) {
  ...
} finally {
  unsubscribe?.()
  unsubscribe = null

  if (!sse.isClosed()) {
    sse.close()
  }

  agent.clearAbortController?.(controller)
}
```

### 推荐进一步重构

将 AbortController 所有权收敛到 `Agent.prompt()` 内部，路由层只监听客户端关闭并调用：

```ts
agent.abort()
```

### 修改文件

```text
playground/backend/src/api/routes.ts
playground/backend/src/core/agent.ts
playground/backend/src/api/routes.test.ts
```

### 必补测试

```text
1. 同一 session 并发发起两个 chat 请求
2. 第二个请求返回 409 AGENT_BUSY
3. 第一个请求继续正常输出
4. 第二个请求不会覆盖第一个 controller
5. 请求结束后 listener 数量恢复
```

### 验收标准

- [ ] 同 session 并发请求明确返回 409
- [ ] controller 不会串线
- [ ] listener 不泄漏
- [ ] 首个请求不受影响

---

## 4. reset 活跃 session 会产生竞态

### 状态

- [ ] 待处理

### 问题描述

当前 `/api/reset` 直接调用：

```ts
sessionManager.clear(sessionId)
return { success: true }
```

`SessionManager.clear()` 内部：

```ts
session.agent.reset()
session.lastAccessedAt = Date.now()
```

而 `Agent.reset()`：

```ts
this.context.messages = []
this._isStreaming = false
this.abortController = null
```

如果 reset 发生在流式生成中：

```text
旧任务仍在运行
→ context.messages 被清空
→ _isStreaming 被强行设为 false
→ 新请求可能再次进入
→ 旧任务和新任务同时写入同一 context
```

### 风险

- 两个 Agent Loop 并发运行
- 上下文污染
- SSE 输出串线
- reset 后旧工具继续执行

### 推荐方案

教学项目优先采用简单明确的拒绝策略：

```ts
const agent = sessionManager.getAgent(sessionId)

if (!agent) {
  reply.status(404)
  return {
    success: false,
    code: 'SESSION_NOT_FOUND',
    error: 'Session not found',
  }
}

if (agent.state.isStreaming) {
  reply.status(409)
  return {
    success: false,
    code: 'AGENT_BUSY',
    error: 'Cannot reset while agent is streaming',
  }
}

sessionManager.clear(sessionId)
return { success: true }
```

### 另一个问题

当前不存在的 sessionId 也会返回：

```json
{ "success": true }
```

建议改为 404。

### 修改文件

```text
playground/backend/src/api/routes.ts
playground/backend/src/session/session-manager.ts
playground/backend/src/core/agent.ts
```

### 必补测试

```text
1. 不存在 sessionId reset → 404
2. 活跃 session reset → 409
3. 非活跃 session reset → 200 success
4. reset 后 history 为空
```

### 验收标准

- [ ] reset 不会制造并发 Loop
- [ ] 活跃 session 行为明确
- [ ] 不存在 session 返回 404

---

# 三、P1：建议本轮完成

## 5. `Agent.abort()` 对内部创建的 controller 不生效

### 状态

- [ ] 待处理

### 问题描述

当前 `Agent.prompt()` 在没有外部 signal 时创建：

```ts
const internalController = externalSignal
  ? null
  : new AbortController()

const signal = externalSignal || internalController!.signal
```

但没有赋值给：

```ts
this.abortController
```

所以直接使用核心类时：

```ts
const agent = new Agent(...)
agent.prompt('hello')
agent.abort()
```

`abort()` 不一定能真正中止任务。

### 修改建议

让 Agent 自己管理当前任务 controller：

```ts
async prompt(...) {
  if (this._isStreaming) {
    throw new Error('Agent is already streaming')
  }

  this._isStreaming = true

  const controller = new AbortController()
  this.abortController = controller

  const signal = options?.signal
    ? mergeAbortSignals(controller.signal, options.signal)
    : controller.signal

  try {
    await runAgentLoop(..., signal)
  } finally {
    if (this.abortController === controller) {
      this.abortController = null
    }

    this._isStreaming = false
  }
}
```

如果不实现 merge signal，也要统一 AbortController 所有权，避免路由层和 Agent 层同时管理。

### 必补测试

```ts
it('should abort internally managed prompt via agent.abort()', async () => {
  // 不传外部 signal
  // 启动 prompt
  // 调用 agent.abort()
  // 断言任务中止
})
```

### 验收标准

- [ ] Agent 独立使用时 abort 有效
- [ ] API 请求断开时 abort 有效
- [ ] prompt 完成后 controller 被清理

---

## 6. API catch 路径未统一释放 subscribe listener

### 状态

- [ ] 待处理

### 问题描述

正常情况下，收到 `agent_end` 会：

```ts
sse.close()
unsubscribe?.()
```

但 catch 路径只调用：

```ts
sse.close()
```

未必执行：

```ts
unsubscribe?.()
```

而客户端 close 回调又只在 SSE 尚未关闭时清理 listener。

### 风险

- 异常请求后 listener 残留
- 后续事件仍调用已关闭 SSE
- 长时间运行后 listener 数量增长

### 修改建议

使用 finally：

```ts
try {
  await agent.prompt(...)
} catch (error) {
  ...
} finally {
  unsubscribe?.()
  unsubscribe = null

  if (!sse.isClosed()) {
    sse.close()
  }
}
```

### 必补测试

```text
1. LLM 抛异常后 listener 被移除
2. 客户端断开后 listener 被移除
3. AGENT_BUSY 路径不会注册 listener
```

---

## 7. 前端并未对全部 fetch 调用执行 `ensureOk()`

### 状态

- [ ] 待处理

### 已覆盖

当前已检查：

```text
createSession
loadHistory
/api/chat
```

### 尚未覆盖

`sendMessage()` 内部隐式创建 session 时：

```ts
const res = await fetch('/api/sessions', { method: 'POST' })
const data = await res.json()
```

缺少：

```ts
await ensureOk(res)
```

`exportSession()` 中：

```ts
const res = await fetch(`/api/export?sessionId=${sessionId}`)
const data = await res.json()
```

也缺少 `ensureOk()`。

还需要检查 `reset()` 路径是否统一检查。

### 风险

```text
session 创建失败
→ 仍尝试读取 sessionId

export 返回 404 / 500
→ 错误 JSON 被下载为导出文件

reset 失败
→ UI 可能误以为清空成功
```

### 修改建议

所有 fetch 后统一：

```ts
const res = await fetch(...)
await ensureOk(res)
const data = await res.json()
```

### 修改文件

```text
playground/frontend/src/hooks/useAgent.ts
```

### 验收标准

- [ ] 所有 fetch 都执行 `ensureOk()`
- [ ] reset 失败时不清空 UI
- [ ] export 失败时不下载错误 JSON
- [ ] session 创建失败时提示明确

---

## 8. 前端 SSE 流结束时没有 flush decoder 和消费剩余 buffer

### 状态

- [ ] 待处理

### 问题描述

当前前端循环：

```ts
const { done, value } = await reader.read()
if (done) break

buffer += decoder.decode(value, { stream: true })
```

结束时没有：

```ts
buffer += decoder.decode()
```

也没有处理最后剩余的 buffer。

### 风险

通常后端发送完整 `\n\n`，所以大部分场景可运行。但极端情况下：

```text
最后一个 UTF-8 字符跨 chunk
最后一条 SSE 事件没有尾随换行
```

可能丢失最后事件或最后字符。

### 修改建议

抽取统一 parser：

```ts
function processBuffer(buffer: string, flush = false): string {
  const lines = buffer.split('\n')
  const remaining = flush ? '' : lines.pop() || ''

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue
    const data = line.slice(6)
    if (!data) continue

    const event: AgentEvent = JSON.parse(data)
    handleEvent(event)
  }

  if (flush && lines.length === 0 && buffer.startsWith('data: ')) {
    const data = buffer.slice(6)
    if (data) handleEvent(JSON.parse(data))
  }

  return remaining
}
```

循环：

```ts
while (true) {
  const { done, value } = await reader.read()

  if (done) {
    buffer += decoder.decode()
    processBuffer(buffer, true)
    break
  }

  buffer += decoder.decode(value, { stream: true })
  buffer = processBuffer(buffer)
}
```

### 必补测试

```text
1. SSE 最后一条事件无尾随换行仍能处理
2. 中文字符跨 chunk 不乱码
3. 单条 JSON 事件跨 chunk 可以解析
```

---

## 9. tool call 参数 JSON 解析失败后仍可能进入工具执行

### 状态

- [ ] 待处理

### 问题描述

当前 OpenAI tool call 参数 JSON 解析失败时，构造：

```ts
parsedArgs = {
  __parseError: true,
  __raw: tc.argumentsText,
  __error: parseErr.message,
}
```

随后仍作为普通 toolCall 参数进入 Agent Loop。

如果工具 Schema 有 required 字段，通常会被校验挡住；但如果某个工具参数可选或 Schema 较宽松，仍可能执行工具。

### 修改目标

参数 JSON 解析失败时，不得执行工具。

### 修改建议

在 `executeTool()` 最前面增加：

```ts
if (args && args.__parseError) {
  return createToolError({
    toolCallId,
    toolName,
    message: `工具参数 JSON 解析失败：${args.__error}`,
  })
}
```

更推荐从类型设计上将解析错误与业务参数分离，例如：

```ts
type ToolCallContent = {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, unknown>
  parseError?: {
    raw: string
    message: string
  }
}
```

### 必补测试

```text
1. JSON 参数解析失败时不会进入 tool.execute
2. 返回 toolResult.isError = true
3. 日志保留原始参数文本
```

---

## 10. OpenAI UTF-8 测试应覆盖真实 `openaiStream()`

### 状态

- [ ] 待处理

### 问题描述

当前 UTF-8 测试如果只验证：

```ts
const decoder = new TextDecoder()
result += decoder.decode(chunk1, { stream: true })
result += decoder.decode(chunk2, { stream: true })
```

只能证明 `TextDecoder` 本身工作正常，不能证明 `openaiStream()` 正确使用了 decoder。

### 修改建议

Mock `global.fetch`，构造真实 `ReadableStream`：

```ts
const encoder = new TextEncoder()
const payload = 'data: {"choices":[{"delta":{"content":"北京天气"},"finish_reason":null}]}\n\n'
const bytes = encoder.encode(payload)

const body = new ReadableStream({
  start(controller) {
    controller.enqueue(bytes.slice(0, splitIndex))
    controller.enqueue(bytes.slice(splitIndex))
    controller.close()
  },
})
```

然后直接调用 `openaiStream()`，断言最终事件文本是：

```text
北京天气
```

### 验收标准

- [ ] 测试直接调用 `openaiStream()`
- [ ] 错误 decoder 实现会让测试失败
- [ ] 测试覆盖 SSE chunk 拆分

---

# 四、P1：最小示例逻辑问题

## 11. `examples/01-manual-loop` 在 toolResult 后仍会再次生成 toolCall

### 状态

- [ ] 待处理

### 问题描述

当前 `mockLLM()` 仅读取最后一条 user 消息：

```ts
const lastUser = context.messages.findLast((m) => m.role === 'user')
const text = typeof lastUser?.content === 'string'
  ? lastUser.content
  : ''
```

如果输入：

```text
北京天气怎么样？
```

流程是：

```text
用户消息
→ assistant toolCall(weather)
→ toolResult
→ 再次调用 mockLLM
→ lastUser 仍然是 北京天气怎么样？
→ 再次生成 toolCall(weather)
```

因此示例可能残留一个未执行 toolCall，而不是生成最终总结。

### 修改建议

优先处理最后一条消息是 `toolResult`：

```ts
async function mockLLM(
  context: AgentContext
): Promise<AssistantMessage> {
  const lastMessage = context.messages.at(-1)

  if (lastMessage?.role === 'toolResult') {
    const result = lastMessage.content
      .map((item) => item.text)
      .join('')

    return {
      role: 'assistant',
      content: [
        {
          type: 'text',
          text: `天气查询结果：${result}`,
        },
      ],
      stopReason: 'stop',
      timestamp: Date.now(),
    }
  }

  ...
}
```

### 另一个问题

示例注释写：

```text
模拟对话 3：再次触发工具
```

但实际输入是：

```ts
await runAgentLoop('上海呢？', context)
```

匹配规则只识别包含：

```text
天气
```

的文本，因此不会触发天气工具。

建议改为：

```ts
await runAgentLoop('上海天气怎么样？', context)
```

或者实现简单多轮指代解析。

### 修改文件

```text
examples/01-manual-loop/index.ts
```

### 验收标准

- [ ] toolResult 后生成最终总结
- [ ] 历史中不存在未执行 toolCall
- [ ] 第三轮示例与注释一致
- [ ] 示例运行后自然退出

---

## 12. CI 应增加 example 冒烟运行

### 状态

- [ ] 待处理

### 问题描述

当前 CI 只执行：

```bash
npm run typecheck
```

这可以发现类型问题，但无法发现上述 Mock Loop 行为错误。

### 修改建议

example 使用 Mock LLM，不依赖 API Key，可以直接运行：

```yaml
- name: Example typecheck and smoke test
  working-directory: examples/01-manual-loop
  run: |
    npm ci
    npm run typecheck
    npm run start
```

### 验收标准

- [ ] example 在 CI 中真实运行
- [ ] example 自然退出
- [ ] 输出包含天气查询最终总结
- [ ] 输出不残留未执行 toolCall

---

# 五、P2：仓库结构与维护体验

## 13. 将根目录整改文档移动到维护目录

### 状态

- [ ] 建议处理

### 问题描述

根目录新增了多份整改文档和测试脚本：

```text
pi_agent_tutorial_第二轮整改清单（基于最新提交）.md
pi_agent_tutorial_第三轮收尾整改任务单.md
test_e2e.py
```

这些文件放在根目录会逐渐增加噪音。

### 修改建议

整理为：

```text
docs/maintenance/
  second-round-checklist.md
  third-round-checklist.md
  fifth-round-checklist.md

scripts/
  test_e2e.py
```

或者：

```text
.github/maintenance/
```

### 验收标准

- [ ] 根目录保持简洁
- [ ] README 中补充维护文档入口
- [ ] e2e 脚本放入 scripts 或 tests/e2e

---

## 14. 将 `test_e2e.py` 接入 CI 或明确为手工验收脚本

### 状态

- [ ] 建议处理

### 问题描述

当前根目录已经有 `test_e2e.py`，但 CI 尚未执行。

### 修改建议

方案 A：接入 CI。

```yaml
- name: Backend e2e smoke test
  working-directory: playground/backend
  run: |
    npm run build
    npm run start &
    SERVER_PID=$!
    sleep 3
    python ../../scripts/test_e2e.py
    kill $SERVER_PID
```

需要明确 Python 依赖：

```text
requests
```

方案 B：保留手工脚本，但 README 中说明：

```bash
pip install requests
python scripts/test_e2e.py
```

### 推荐

教学仓库优先接入 CI 冒烟测试，能更早发现 API 行为回归。

---

## 15. OpenAI 配置环境变量化

### 状态

- [ ] 可选优化

### 建议

增加：

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

代码中：

```ts
const model = process.env.OPENAI_MODEL || 'gpt-4o-mini'

if (!process.env.OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required when useMock is false'
  )
}
```

### 验收标准

- [ ] 无 Key 时错误明确
- [ ] 模型可以环境变量切换
- [ ] README 有配置示例
- [ ] 提供 `.env.example`

---

# 六、推荐实施顺序

## 第一批：立即处理

- [ ] 1. 普通聊天执行 maxMessages 裁剪
- [ ] 2. 真正按完整 turn 裁剪
- [ ] 3. 同 session 并发请求返回 409
- [ ] 4. reset 活跃 session 返回 409

## 第二批：生命周期和前端边界

- [ ] 5. Agent.abort() 统一 controller 所有权
- [ ] 6. finally 统一释放 subscribe listener
- [ ] 7. 所有 fetch 使用 ensureOk()
- [ ] 8. 前端 SSE flush decoder 和剩余 buffer
- [ ] 9. tool call parse error 禁止进入工具执行

## 第三批：测试可信度

- [ ] 10. UTF-8 测试升级为 openaiStream 集成测试
- [ ] 增加普通 maxMessages 裁剪测试
- [ ] 增加完整 turn 裁剪测试
- [ ] 增加并发 chat 测试
- [ ] 增加 reset 活跃 session 测试

## 第四批：示例和 CI

- [ ] 11. 修复 examples/01-manual-loop Mock LLM
- [ ] 12. CI 增加 example 冒烟运行
- [ ] 14. e2e 脚本接入 CI 或补文档说明

## 第五批：仓库整理

- [ ] 13. 整改文档归档
- [ ] 15. OpenAI 配置环境变量化

---

# 七、建议验收命令

## 根目录

```bash
npm ci
npm run docs:build
```

## Backend

```bash
cd playground/backend
npm ci
npm run build
npm test -- --run
npm run start
```

## Frontend

```bash
cd playground/frontend
npm ci
npm run build
```

## Example

```bash
cd examples/01-manual-loop
npm ci
npm run typecheck
npm run start
```

## E2E

```bash
pip install requests
python scripts/test_e2e.py
```

---

# 八、必须补齐的测试

## Agent Loop

```text
1. 普通聊天超过 maxMessages 后裁剪
2. 工具聊天超过 maxMessages 后裁剪
3. 裁剪后保留完整 user turn
4. toolCall 与 toolResult 不拆散
5. 第 maxTurns 轮正常完成返回 success
```

## API 与 Session

```text
1. 同 session 并发 chat → 第二个请求 409
2. 并发请求不会覆盖 controller
3. LLM 异常后 listener 被释放
4. 活跃 session reset → 409
5. 不存在 session reset → 404
```

## OpenAI Stream

```text
1. 中文 SSE 跨 chunk 解码正确
2. SSE 最后一条事件无换行仍被处理
3. tool call 前文本保留
4. tool call JSON 参数解析失败时不执行工具
```

## Frontend

```text
1. session 创建失败时显示错误
2. reset 失败时不清空 UI
3. export 失败时不下载错误 JSON
4. SSE 最后一条事件可被处理
```

## Example

```text
1. 天气工具执行后生成最终总结
2. 示例历史中不存在未执行 toolCall
3. 第三轮输入与注释一致
4. CI 中真实运行并自然退出
```

---

# 九、交付要求

请 Kimi Code 完成后输出：

```text
1. 修改文件列表
2. 每个问题的修复说明
3. 新增测试列表
4. 以下命令真实执行结果：
   - npm run docs:build
   - backend npm run build
   - backend npm test -- --run
   - frontend npm run build
   - example npm run typecheck
   - example npm run start
   - e2e smoke test
5. GitHub Actions 结果
6. 未完成问题
```

不要只回复：

```text
已优化完成
```

---

# 十、本轮完成标准

整改完成后，项目应满足：

```text
普通聊天和工具聊天都受 maxMessages 限制
裁剪按完整 user turn 执行
同 session 并发请求不会串线
reset 不会制造并发 Loop
Agent.abort() 独立使用时有效
异常路径无 listener 泄漏
前端全部 HTTP 错误可见
前端 SSE 收尾健壮
工具参数 parse error 不会触发工具执行
最小示例逻辑正确并纳入 CI 冒烟验证
仓库根目录保持整洁
```


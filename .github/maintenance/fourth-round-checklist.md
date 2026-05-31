# pi-agent-tutorial 第四轮运行时与边界整改任务单

> 基于最新提交 `1628599` 重新审查。
>
> 目标：在 CI 已([github.com](https://github.com/wusiration/pi-agent-tutorial/actions/runs/26709842995))、并发清理、上下文裁剪和教学示例逻辑问题。
>
> 适合直接交给 Kimi Code 执行。

---

# 一、最新版本状态

最新版本已经完成第三轮大部分整改，并且 CI 已经成功运行：

```text
quality      ✅
build-docs   ✅
deploy       ✅
```

当前已经确认完成：

- [x] `maxTurns` 第 10 轮正常结束不再误报超限
- [x] OpenAI 流式响应复用 `TextDecoder`，支持 UTF-8 跨 chunk 解码
- [x] tool call 前的文本内容保留在 assistant message 中
- [x] `/api/chat` 对未知 `sessionId` 返回 404
- [x] Fastify `onClose` 调用 `sessionManager.dispose()`
- [x] `SessionManager` 的 timer 已调用 `unref()`
- [x] 前端 `message_end` 后删除 messageId 映射
- [x] example 增加 `typecheck`
- [x] CI 运行 backend build/test、frontend build、example typecheck 和 docs build

当前项目已经从“构建验证阶段”进入“运行时边界打磨阶段”。

---

# 二、P0：建议优先修复的真实问题

## 1. `maxMessages` 对普通聊天仍然不生效

### 状态

- [ ] 待处理

### 问题描述

当前 `runAgentLoop()` 中，消息裁剪逻辑只在执行完工具后调用：

```ts
// 添加工具结果
for (const tr of toolResults) {
  context.messages.push(tr)
}

emit({ type: 'turn_end', ... })

if (config.maxMessages && context.messages.length > config.maxMessages) {
  context.messages = trimMessagesByTurns(
    context.messages,
    config.maxMessages
  )
}
```

但是普通聊天在没有工具调用时会提前：

```ts
if (toolCalls.length === 0) {
  emit({ type: 'turn_end', ... })
  completed = true
  break
}
```

因此普通对话不会走到裁剪逻辑。

### 实际风险

```text
用户持续普通聊天
→ user + assistant 消息不断追加
→ maxMessages 不生效
→ context.messages 无限增长
→ 内存、Token 成本和响应延迟增加
```

### 修改目标

无论本轮是否调用工具，只要上下文超过限制，都必须裁剪。

### 推荐实现

抽取统一方法：

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

在所有 turn 结束路径调用：

```ts
if (toolCalls.length === 0) {
  emit({ type: 'turn_end', message: assistantMsg, toolResults: [] })
  trimContextMessages(context, config.maxMessages)
  completed = true
  break
}
```

工具调用路径也调用：

```ts
emit({ type: 'turn_end', message: assistantMsg, toolResults })
trimContextMessages(context, config.maxMessages)
```

### 需要检查的文件

```text
playground/backend/src/core/agent-loop.ts
playground/backend/src/core/agent-loop.test.ts
```

### 当前测试存在的问题

现有测试：

```ts
it('should trim messages when maxMessages is exceeded', ...)
```

实际上只创建了：

```text
user + assistant = 2 条消息
maxMessages = 4
```

并没有真正超过限制，因此即使完全删除裁剪逻辑，测试仍然可能通过。

### 必补测试

```ts
it('should trim normal chat messages when maxMessages is exceeded', async () => {
  // 预先放入多条普通 user / assistant 历史
  // 再执行一次无工具调用的普通对话
  // maxMessages 设置成较小值
  // 断言 context.messages.length <= maxMessages
})
```

### 验收标准

- [ ] 普通聊天超过限制后会裁剪
- [ ] 工具调用场景超过限制后会裁剪
- [ ] 测试确实构造出超过 `maxMessages` 的上下文
- [ ] CI 中测试可阻止该问题回归

---

## 2. `trimMessagesByTurns()` 并没有真正按完整 turn 裁剪

### 状态

- [ ] 待处理

### 问题描述

当前函数逻辑本质上是：

```ts
const trimmed = messages.slice(-maxMessages)

while (trimmed.length > 0 && trimmed[0]?.role === 'toolResult') {
  trimmed.shift()
}
```

它只避免了“第一条消息是孤立 toolResult”，但无法保证：

```text
user
assistant(toolCall)
toolResult
assistant(final)
```

这一组完整 turn 不会被截断。

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

这类上下文虽然未必立刻报错，但会降低模型对历史的理解质量。

### 修改目标

真正按“用户发起的一轮对话”裁剪。

### 推荐实现思路

从后向前保留 turn：

```ts
function trimMessagesByTurns(
  messages: Message[],
  maxMessages: number
): Message[] {
  if (messages.length <= maxMessages) return messages

  const kept: Message[] = []
  let currentTurn: Message[] = []

  for (let i = messages.length - 1; i >= 0; i--) {
    const message = messages[i]
    currentTurn.unshift(message)

    if (message.role === 'user') {
      if (
        kept.length > 0 &&
        kept.length + currentTurn.length > maxMessages
      ) {
        break
      }

      kept.unshift(...currentTurn)
      currentTurn = []
    }
  }

  // 如果最近内容没有 user 开头，避免保留不完整 turn
  return kept.length > 0 ? kept : messages.slice(-maxMessages)
}
```

可以根据项目需求进一步完善。

### 必补测试

```text
1. 裁剪后第一条消息优先为 user
2. assistant(toolCall) 与 toolResult 不被拆散
3. 最近一轮完整上下文被保留
4. 多轮普通聊天裁剪正确
5. 混合普通聊天与工具调用时裁剪正确
```

### 验收标准

- [ ] 不保留孤立 toolResult
- [ ] 不从半个 turn 开始
- [ ] 最近对话完整保留
- [ ] 超限后消息数受控

---

## 3. 同一 session 并发 `/api/chat` 可能造成 AbortController 串线和订阅泄漏

### 状态

- [ ] 待处理

### 问题描述

当前 `/api/chat` 处理顺序大致是：

```ts
const controller = new AbortController()
agent.setAbortController(controller)

unsubscribe = agent.subscribe(...)

await agent.prompt(...)
```

但 `Agent.prompt()` 内部才检查：

```ts
if (this._isStreaming) {
  throw new Error('Agent is already streaming')
}
```

如果同一个 session 同时发起两个请求：

```text
请求 A：已经流式生成中
请求 B：进入 /api/chat
```

请求 B 会先覆盖：

```ts
agent.setAbortController(controllerB)
```

然后才因为 `Agent is already streaming` 抛错。

### 风险

```text
1. Agent 当前保存的 AbortController 被请求 B 覆盖
2. session 删除或 reset 时，可能 abort 错控制器
3. 请求 B 的 subscribe 监听器可能残留
4. 后续事件仍会触发已关闭 SSE 的 listener
5. 长时间运行后产生 listener 泄漏
```

### 修改目标

在创建 SSE、注册订阅和设置 controller 之前，先拒绝并发请求。

### 推荐实现

路由入口增加：

```ts
if (agent.state.isStreaming) {
  reply.status(409)
  return {
    error: 'Agent is already streaming',
    code: 'AGENT_BUSY',
  }
}
```

然后再创建 SSE：

```ts
const sse = new SSEConnection(reply)
const controller = new AbortController()
agent.setAbortController(controller)
```

同时确保所有路径清理订阅：

```ts
try {
  await agent.prompt(...)
} catch (error) {
  ...
} finally {
  unsubscribe?.()
  agent.clearAbortController?.(controller)
}
```

更推荐把 AbortController 生命周期收敛到 `Agent.prompt()` 内部，不让路由层直接修改 Agent 的 controller。

### 需要检查的文件

```text
playground/backend/src/api/routes.ts
playground/backend/src/core/agent.ts
```

### 必补测试

```text
1. 同一 session 同时发送两个 chat 请求
2. 第二个请求返回 409 AGENT_BUSY
3. 第一个请求仍可继续正常输出
4. 第二个请求不会覆盖第一个请求的 controller
5. 结束后 listener 数量回到原值
```

### 验收标准

- [ ] 并发请求被明确拒绝
- [ ] controller 不会串线
- [ ] subscribe 不泄漏
- [ ] 首个请求不受第二个请求影响

---

## 4. reset 活跃 session 时没有先 abort，可能产生竞态

### 状态

- [ ] 待处理

### 问题描述

当前：

```ts
sessionManager.clear(sessionId)
```

内部仅：

```ts
session.agent.reset()
session.lastAccessedAt = Date.now()
```

而 `Agent.reset()` 会：

```ts
this.context.messages = []
this._isStreaming = false
this.abortController = null
```

如果 reset 发生在流式任务运行中：

```text
旧任务仍然继续执行
但 _isStreaming 已被强制设为 false
context.messages 被清空
新请求又可能进入同一个 Agent
```

### 风险

- 同一个 Agent 内出现两个并行 loop
- 上下文被旧任务和新任务同时写入
- SSE 输出串线
- reset 后旧任务继续产生工具调用

### 修改目标

reset 前先明确处理活跃任务。

### 推荐方案

方案 A：活跃时拒绝 reset。

```ts
if (agent.state.isStreaming) {
  reply.status(409)
  return {
    success: false,
    code: 'AGENT_BUSY',
    error: 'Cannot reset while agent is streaming',
  }
}
```

方案 B：reset 主动 abort，再等待任务退出后清理。

```ts
agent.abort()
agent.reset()
```

教学项目优先推荐方案 A，语义更简单。

### 补充问题

未知 sessionId 当前也会返回：

```json
{ "success": true }
```

建议改为 404。

### 需要检查的文件

```text
playground/backend/src/api/routes.ts
playground/backend/src/session/session-manager.ts
playground/backend/src/core/agent.ts
```

### 必补测试

```text
1. 不存在 sessionId reset → 404
2. 活跃 session reset → 409
3. 非活跃 session reset → success
4. reset 后历史为空
```

### 验收标准

- [ ] reset 不会制造并发 loop
- [ ] 活跃 session 行为明确
- [ ] 不存在 session 返回 404

---

# 三、P1：建议本轮完成

## 5. `Agent.abort()` 对内部创建的 controller 不生效

### 状态

- [ ] 待处理

### 问题描述

`Agent.prompt()` 中：

```ts
const externalSignal = options?.signal
const internalController = externalSignal
  ? null
  : new AbortController()

const signal = externalSignal || internalController!.signal
```

但内部创建的 controller 没有赋值给：

```ts
this.abortController
```

因此如果直接使用核心类：

```ts
const agent = new Agent(...)
agent.prompt('hello')
agent.abort()
```

`abort()` 可能无法中止当前执行。

### 修改目标

Agent 自己管理当前任务 controller。

### 推荐实现

```ts
async prompt(...) {
  if (this._isStreaming) {
    throw new Error('Agent is already streaming')
  }

  const controller = new AbortController()
  this.abortController = controller

  const signal = mergeAbortSignals(
    controller.signal,
    options?.signal
  )

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

如果不实现 signal merge，至少在内部 controller 和外部 signal 之间统一一个清晰方案。

### 必补测试

```ts
it('should abort an internally managed prompt via agent.abort()', async () => {
  // 不从外部传 signal
  // 调用 prompt
  // 调用 agent.abort()
  // 断言任务中止
})
```

### 验收标准

- [ ] Agent 独立使用时 abort 有效
- [ ] API 使用时 abort 有效
- [ ] 正常结束后 controller 清理

---

## 6. API 异常路径可能残留订阅 listener

### 状态

- [ ] 待处理

### 问题描述

正常路径中，收到：

```ts
agent_end
```

会调用：

```ts
unsubscribe?.()
```

但异常 catch 路径中：

```ts
sse.close()
```

未必会调用：

```ts
unsubscribe?.()
```

而 `request.raw.on('close')` 中又只有在 SSE 尚未关闭时才清理。

### 修改建议

无论成功、失败、abort，都在 finally 统一清理：

```ts
finally {
  unsubscribe?.()
  unsubscribe = null

  if (!sse.isClosed()) {
    sse.close()
  }
}
```

### 必补测试

```text
1. LLM 抛异常后 listener 被释放
2. Agent busy 后 listener 不增加
3. 客户端中断后 listener 被释放
```

---

## 7. 前端并未对所有 fetch 调用执行 `ensureOk()`

### 状态

- [ ] 待处理

### 问题描述

当前以下请求已经调用 `ensureOk()`：

```text
createSession
loadHistory
sendMessage 的 /api/chat
```

但以下路径仍缺失：

```text
sendMessage 中隐式创建 session
reset
exportSession
```

### 可能表现

```text
/api/sessions 返回错误
→ 仍然执行 res.json()
→ currentSessionId 可能为空

/api/reset 返回 404 / 500
→ 前端仍然清空 UI

/api/export 返回错误 JSON
→ 被当成正常导出文件下载
```

### 修改建议

```ts
const res = await fetch(...)
await ensureOk(res)
const data = await res.json()
```

覆盖所有 fetch。

### 需要检查的文件

```text
playground/frontend/src/hooks/useAgent.ts
```

### 验收标准

- [ ] 所有 fetch 都检查 `response.ok`
- [ ] reset 失败时不清空 UI
- [ ] export 失败时不下载错误 JSON
- [ ] session 创建失败时显示明确错误

---

## 8. 前端 SSE 解码结束时应 flush decoder 并处理剩余 buffer

### 状态

- [ ] 待处理

### 问题描述

前端 SSE parser 当前在：

```ts
if (done) break
```

时直接退出，没有：

```ts
decoder.decode()
```

也没有处理剩余 `buffer`。

后端目前通常发送完整的：

```text
data: ...\n\n
```

所以大多数场景可以运行，但健壮性不足。

### 修改建议

抽取 parser：

```ts
const decoder = new TextDecoder()
let buffer = ''

while (true) {
  const { done, value } = await reader.read()

  if (done) {
    buffer += decoder.decode()
    processBuffer(buffer, true)
    break
  }

  buffer += decoder.decode(value, { stream: true })
  buffer = processBuffer(buffer, false)
}
```

### 验收标准

- [ ] SSE 最后一条事件没有尾随换行时仍能处理
- [ ] 中文跨 chunk 不乱码
- [ ] 单条事件跨多个 chunk 时能正确解析

---

## 9. OpenAI UTF-8 测试没有覆盖真实 `openaiStream()`

### 状态

- [ ] 待处理

### 问题描述

当前新增测试验证的是：

```ts
const decoder = new TextDecoder()
result += decoder.decode(chunk1, { stream: true })
result += decoder.decode(chunk2, { stream: true })
```

这证明浏览器 / Node 的 `TextDecoder` 工作正常，但没有证明：

```ts
openaiStream()
```

内部真的正确使用 decoder。

即使未来误改回：

```ts
new TextDecoder().decode(value)
```

该测试仍然可能通过。

### 修改目标

增加 `openaiStream()` 集成级单测。

### 推荐测试思路

Mock `global.fetch`：

```ts
const encoder = new TextEncoder()
const payload = 'data: {...北京天气...}\n\n'
const bytes = encoder.encode(payload)

// 故意在中文字符字节中间切开
const body = new ReadableStream({
  start(controller) {
    controller.enqueue(bytes.slice(0, splitIndex))
    controller.enqueue(bytes.slice(splitIndex))
    controller.close()
  }
})
```

断言：

```text
message_update 拼接结果为 北京天气
message_end 内容为 北京天气
```

### 验收标准

- [ ] 测试直接调用 `openaiStream()`
- [ ] 测试可在 decoder 使用错误方式时失败
- [ ] 测试覆盖 SSE chunk 拆分

---

## 10. tool call 参数 parse error 应直接变成错误结果

### 状态

- [ ] 待处理

### 问题描述

当前 JSON 解析失败时，会构造：

```ts
{
  __parseError: true,
  __raw: tc.argumentsText,
  __error: parseErr.message
}
```

然后仍然作为工具参数继续进入 Agent Loop。

大多数有 required 字段的工具会被参数校验挡住，但如果某个工具没有 required 字段，仍可能继续执行。

### 修改建议

在 `executeTool()` 前显式识别：

```ts
if (args.__parseError) {
  return createToolError({
    toolCallId,
    toolName,
    message: `工具参数 JSON 解析失败: ${args.__error}`,
  })
}
```

更理想的是给 toolCall content 增加明确错误字段，而不是把内部错误塞进业务参数。

### 验收标准

- [ ] JSON 参数解析失败时不会执行工具
- [ ] toolResult 明确标记 `isError: true`
- [ ] 日志保留 raw 参数

---

# 四、P1：教学示例问题

## 11. `examples/01-manual-loop` 的 Mock LLM 逻辑仍然错误

### 状态

- [ ] 待处理

### 问题描述

example 中的 `mockLLM()` 只读取：

```ts
const lastUser = context.messages.findLast(
  (m) => m.role === 'user'
)
```

如果用户问：

```text
北京天气怎么样？
```

执行流程是：

```text
用户消息
→ assistant toolCall(weather)
→ toolResult
→ 再次调用 mockLLM
→ lastUser 仍然是 北京天气怎么样？
→ 再次生成 toolCall(weather)
→ 示例直接结束
```

最终历史中会残留一个没有执行的 toolCall，而不是对工具结果进行总结。

### 修改目标

Mock LLM 必须识别最后一条消息是否是 `toolResult`。

### 推荐实现

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

  const lastUser = context.messages.findLast(
    (message) => message.role === 'user'
  )

  ...
}
```

### 另一个文档问题

当前示例注释写：

```text
模拟对话 3：再次触发工具
```

但实际输入是：

```ts
await runAgentLoop('上海呢？', context)
```

规则只匹配包含：

```text
天气
```

的文本，所以不会再次调用工具。

建议改成：

```ts
await runAgentLoop('上海天气怎么样？', context)
```

或者真正实现简单多轮指代。

### 必补验证

运行：

```bash
cd examples/01-manual-loop
npm run start
```

确认输出为：

```text
用户：北京天气怎么样？
助手：我来查询北京的天气。
执行工具：weather(...)
工具结果：...
助手：天气查询结果：...
对话结束
```

### 验收标准

- [ ] toolResult 后生成最终回答
- [ ] 历史中不残留未执行 toolCall
- [ ] 第三次示例与注释一致
- [ ] CI 增加 example 冒烟运行，而不只是 typecheck

---

## 12. CI 应增加 example 冒烟运行

### 状态

- [ ] 待处理

### 问题描述

当前 CI 只运行：

```bash
npm run typecheck
```

这能发现类型问题，但无法发现上面的 Mock Loop 行为错误。

### 修改建议

example 使用 Mock LLM，不依赖 API Key，可以直接在 CI 中运行：

```yaml
- name: Example typecheck and smoke test
  working-directory: examples/01-manual-loop
  run: |
    npm ci
    npm run typecheck
    npm run start
```

### 验收标准

- [ ] example 会在 CI 中真实运行
- [ ] example 能自然退出
- [ ] 输出不包含未执行 toolCall

---

# 五、P2：建议顺手处理

## 13. GitHub Actions 已出现 Node.js 20 action runtime 弃用警告

### 状态

- [ ] 待处理

### 问题描述

最新 CI 虽然成功，但 GitHub Actions 已经产生警告：

```text
Node.js 20 actions are deprecated.
Actions will be forced to run with Node.js 24 by default starting June 16th, 2026.
Node.js 20 will be removed from the runner on September 16th, 2026.
```

涉及：

```text
actions/checkout@v4
actions/setup-node@v4
actions/upload-pages-artifact@v3 / upload-artifact
actions/deploy-pages@v4
```

### 修改建议

先在 CI 中增加：

```yaml
env:
  FORCE_JAVASCRIPT_ACTIONS_TO_NODE24: true
```

验证现有 Actions 在 Node.js 24 runtime 下是否仍然工作。

同时关注官方是否发布支持 Node.js 24 的新 major 版本，发布后及时升级。

### 验收标准

- [ ] 开启 Node.js 24 action runtime 后 CI 仍通过
- [ ] 弃用警告减少或消失
- [ ] 记录升级策略

---

## 14. README 学习路径中的“跑 docs/demos”表述可更准确

### 状态

- [ ] 待处理

### 问题描述

README 已经正确说明：

```text
examples/ 目前只有一个独立可运行示例
```

但学习路径仍然写：

```text
跑 docs/demos/ 的 5 个 Demo（逐个验证）
```

如果 `docs/demos/` 主要是教程文档，不是独立落盘项目，这个表述会让读者误解。

### 修改建议

改成：

```text
阅读 docs/demos/ 的 5 个渐进式 Demo，按章节步骤逐个验证
```

或者补齐：

```text
examples/02 - examples/05
```

### 验收标准

- [ ] README 表述与真实仓库目录一致
- [ ] 不引导读者进入不存在的独立工程目录

---

## 15. OpenAI 模型和 API Key 建议改为显式配置

### 状态

- [ ] 可选优化

### 问题描述

当前代码中模型写死为：

```ts
model: 'gpt-4o-mini'
```

API Key 缺失时也会继续请求：

```text
Authorization: Bearer
```

### 修改建议

```ts
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

if (!OPENAI_API_KEY) {
  throw new Error(
    'OPENAI_API_KEY is required when useMock is false'
  )
}
```

增加：

```text
.env.example
```

内容：

```env
OPENAI_API_KEY=
OPENAI_BASE_URL=https://api.openai.com/v1
OPENAI_MODEL=gpt-4o-mini
```

### 验收标准

- [ ] 无 Key 时错误清晰
- [ ] 模型可通过环境变量替换
- [ ] README 有配置说明

---

# 六、推荐实施顺序

## 第一批：运行时正确性

- [ ] 1. 普通聊天也执行 maxMessages 裁剪
- [ ] 2. 真正按完整 turn 裁剪
- [ ] 3. 同 session 并发请求返回 409
- [ ] 4. reset 活跃 session 的竞态处理

## 第二批：生命周期与错误处理

- [ ] 5. 修复 Agent 内部 abort
- [ ] 6. finally 统一释放订阅
- [ ] 7. 前端所有 fetch 使用 ensureOk
- [ ] 8. 前端 SSE flush 和剩余 buffer 处理
- [ ] 10. tool call parse error 禁止进入工具执行

## 第三批：测试可信度

- [ ] 9. UTF-8 测试升级成 openaiStream 集成测试
- [ ] 强化 maxMessages 测试
- [ ] 增加并发 chat 测试
- [ ] 增加 reset 活跃 session 测试

## 第四批：教学示例

- [ ] 11. 修复 examples/01-manual-loop 的 Mock LLM
- [ ] 12. CI 增加 example 冒烟运行

## 第五批：维护体验

- [ ] 13. GitHub Actions Node.js 24 兼容验证
- [ ] 14. README 学习路径表述调整
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

---

# 八、必须新增或强化的测试

## Agent Loop

```text
1. 普通聊天超过 maxMessages 后裁剪
2. 工具调用超过 maxMessages 后裁剪
3. 裁剪后保留完整 turn
4. 裁剪后不保留孤立 toolResult
5. 第 maxTurns 轮正常回答仍为 success
```

## API 与 Session

```text
1. 同 session 并发 chat → 第二个请求 409
2. 并发失败后 listener 数量不增加
3. 活跃 session reset → 409 或明确 abort
4. 不存在 session reset → 404
5. TTL 删除活跃 Agent 时正确 abort
```

## OpenAI Stream

```text
1. UTF-8 中文 SSE 数据跨 chunk 解码正确
2. SSE 最后一条事件无换行时仍解析
3. 文本 + toolCall 同时保留
4. tool call 参数 JSON 解析失败时不执行工具
```

## Frontend

```text
1. createSession 失败时显示错误
2. reset 失败时不清空 UI
3. export 失败时不下载错误文件
4. SSE 最后一条事件可被处理
```

## Example

```text
1. weather toolResult 后生成最终总结
2. 历史中不残留未执行 toolCall
3. example 可以在 CI 中自然退出
```

---

# 九、交付要求

请 Kimi Code 完成后输出：

```text
1. 修改文件列表
2. 每个问题的修复说明
3. 新增或强化的测试列表
4. 以下命令的真实输出摘要：
   - npm run docs:build
   - backend npm run build
   - backend npm test -- --run
   - frontend npm run build
   - example npm run typecheck
   - example npm run start
5. GitHub Actions 结果
6. 尚未解决的问题
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
裁剪不会破坏完整 turn
同 session 并发请求不会串线
reset 不会制造竞态
Agent.abort 在核心类独立使用时有效
所有订阅都可释放
前端所有 HTTP 错误可见
SSE 解析边界更稳健
OpenAI UTF-8 测试能真实覆盖 openaiStream
最小示例逻辑正确并在 CI 中真实运行
Actions 已验证 Node.js 24 runtime 兼容性
```

本轮完成后，再考虑增加新 Demo 或高级功能。


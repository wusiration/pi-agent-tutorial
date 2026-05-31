# pi-agent-tutorial 第三轮收尾整改任务单

> 目标：完成最新版本的收尾打磨，修复剩余边界问题，并补齐自动化验收。
>
> 适合直接交给 Kimi Code 执行。
>
> 原则：不要继续扩大功能范围，优先处理正确性、资源控制、流式解码和 CI 验证。

---

# 一、当前状态

上一轮核心整改已经基本完成：

- [x] `message_start / message_update / message_end` 已统一携带 `messageId`
- [x] 前端不再依赖 timestamp 推导消息 ID
- [x] `SessionManager` 已直接持有 `Agent`
- [x] `sessionId` 已改用 `randomUUID()`
- [x] backend 启动路径已按真实 dist 结构调整
- [x] Mock `delay()` 已清理 abort listener
- [x] `agent_end` 已统一带 `success / error / aborted` 状态
- [x] CI 已增加 backend build/test、frontend build 和 docs build
- [x] README 已修正 examples 覆盖范围描述

当前项目已经进入收尾阶段。

本轮只处理：

1. `maxTurns` 边界误判
2. `maxMessages` 配置未生效
3. OpenAI UTF-8 流式解码问题
4. tool call 前文本丢失
5. session API 语义一致性
6. 服务关闭资源释放
7. 前端 HTTP 错误处理
8. 小型内存优化
9. example CI 真正校验
10. 边界测试补齐

---

# 二、P0：必须修复

## 1. 修复第 `maxTurns` 轮正常结束却被误判为超限

### 问题描述

当前循环逻辑可能类似：

```ts
while (turnCount < maxTurns) {
  turnCount++

  const result = await callLLM(...)

  if (toolCalls.length === 0) {
    break
  }
}

if (turnCount >= maxTurns) {
  emit({
    type: 'agent_end',
    status: 'error',
    error: {
      code: 'MAX_TURNS_EXCEEDED',
    },
  })
}
```

问题在于：

```text
前 9 轮调用工具
第 10 轮返回最终文本
```

这种情况本应成功，但 `turnCount >= maxTurns` 仍然成立，可能被错误标记为：

```text
MAX_TURNS_EXCEEDED
```

### 修改目标

区分：

```text
A. 第 maxTurns 轮正常完成
B. 第 maxTurns 轮仍然继续请求工具
```

只有 B 应当报错。

### 推荐实现

方案一：正常完成时立即返回。

```ts
if (toolCalls.length === 0) {
  emit({
    type: 'turn_end',
    message: assistantMessage,
    toolResults: [],
  })

  emit({
    type: 'agent_end',
    status: 'success',
    messages: context.messages,
  })

  return newMessages
}
```

方案二：显式记录结束原因。

```ts
let completed = false

while (turnCount < maxTurns) {
  turnCount++

  const result = await callLLM(...)

  if (toolCalls.length === 0) {
    completed = true
    break
  }
}

if (!completed) {
  emitMaxTurnsExceeded()
}
```

### 需要检查的文件

```text
playground/backend/src/core/agent-loop.ts
playground/backend/src/core/agent-loop.test.ts
```

### 必补测试

```ts
it('should succeed when final answer arrives exactly on the last allowed turn', async () => {
  // 前 maxTurns - 1 次返回 toolCall
  // 第 maxTurns 次返回普通 assistant 文本
  // 断言最终 agent_end.status === 'success'
})
```

### 验收标准

- [ ] 第 `maxTurns` 轮正常回答时返回 `success`
- [ ] 第 `maxTurns` 轮仍请求工具时返回 `MAX_TURNS_EXCEEDED`
- [ ] 原有无限工具循环测试仍通过

---

## 2. 让 `maxMessages` 配置真正生效

### 问题描述

`SessionManager` 仍然保留：

```ts
maxMessages?: number
```

但消息实际存储在：

```ts
session.agent.state.messages
```

当前缺少真正的裁剪逻辑，因此单个 session 上下文会持续增长。

### 风险

```text
长期对话
→ messages 数量持续增长
→ 内存增加
→ LLM 上下文越来越大
→ Token 成本增加
→ 响应速度下降
```

### 修改目标

确保每个 session 的历史消息数量受到 `maxMessages` 限制。

### 推荐实现

不要简单：

```ts
messages.slice(-maxMessages)
```

因为可能切断：

```text
assistant toolCall
→ toolResult
```

应当按 turn 裁剪，保留完整消息组。

#### 简化实现思路

```ts
function trimMessagesByTurns(
  messages: Message[],
  maxMessages: number
): Message[] {
  if (messages.length <= maxMessages) return messages

  const trimmed = messages.slice(-maxMessages)

  // 避免从孤立 toolResult 开始
  while (trimmed[0]?.role === 'toolResult') {
    trimmed.shift()
  }

  return trimmed
}
```

#### 更推荐的实现

按完整 turn 组织消息后再裁剪：

```text
user
assistant
assistant(toolCall)
toolResult
assistant
```

优先保留最近的完整 turn。

### 建议增加

```ts
agent.trimMessages(maxMessages)
```

或者：

```ts
sessionManager.trimSessionMessages(sessionId)
```

在每次 turn 完成后调用。

### 需要检查的文件

```text
playground/backend/src/session/session-manager.ts
playground/backend/src/core/agent.ts
playground/backend/src/core/agent-loop.ts
```

### 必补测试

```ts
it('should trim messages when maxMessages is exceeded', () => {
  // 插入超过 maxMessages 的消息
  // 断言最终数量受限
})

it('should not keep orphan tool results after trimming', () => {
  // 构造 assistant toolCall + toolResult
  // 断言裁剪后不会从孤立 toolResult 开始
})
```

### 验收标准

- [ ] 消息数量不会无限增长
- [ ] `maxMessages` 配置真实生效
- [ ] 裁剪后不存在孤立 `toolResult`
- [ ] 裁剪后最近对话仍完整
- [ ] README 或文档说明：生产环境更适合 token 预算 + compaction

---

## 3. 修复 OpenAI UTF-8 流式解码问题

### 问题描述

如果每次读取网络字节块时都重新创建：

```ts
new TextDecoder().decode(value)
```

那么 UTF-8 多字节字符被拆到两个 chunk 时，decoder 无法保留跨 chunk 状态。

例如：

```text
北
```

可能被拆成多个字节块，最终出现乱码或替换字符。

### 修改目标

复用同一个 `TextDecoder`，开启 stream 模式。

### 推荐实现

```ts
const decoder = new TextDecoder()

while (true) {
  const { done, value } = await reader.read()

  if (done) {
    buffer += decoder.decode()
    break
  }

  buffer += decoder.decode(value, { stream: true })
}
```

### 需要检查的文件

```text
playground/backend/src/llm/openai-client.ts
```

### 必补测试

```ts
it('should decode UTF-8 characters split across chunks', () => {
  const bytes = new TextEncoder().encode('北京天气')

  // 故意在中文字符中间拆分字节
  // 使用同一个 decoder + stream:true
  // 断言最终字符串仍然是 北京天气
})
```

### 验收标准

- [ ] 中文字符跨 chunk 时不乱码
- [ ] 英文流式输出保持正常
- [ ] SSE buffer 拼接逻辑保持正常
- [ ] tool call JSON 参数仍可正确拼接

---

# 三、P1：建议本轮完成

## 4. 保留 tool call 前的文本内容

### 问题描述

模型可能返回：

```text
我先查询天气。
[toolCall: weather]
```

流式阶段前端可以看到文本，但如果最终 assistant message 只保存：

```ts
content: toolCallContent
```

那么工具调用前的文本会从历史消息中丢失。

### 风险

- 前端看到的内容和历史记录不一致
- 下一轮 LLM 上下文不完整
- 调试时难以还原模型真实输出

### 修改目标

最终 assistant message 同时保留：

```text
text content
toolCall content
```

### 推荐实现

```ts
const assistantMessage: AssistantMessage = {
  role: 'assistant',
  content: [
    ...currentContent,
    ...toolCallContent,
  ],
  stopReason: 'toolUse',
  timestamp: Date.now(),
}
```

需要确认 `currentContent` 里不会重复插入内容。

### 需要检查的文件

```text
playground/backend/src/llm/openai-client.ts
```

### 必补测试

```ts
it('should preserve text emitted before tool calls', () => {
  // 模拟：文本 + toolCall
  // 断言最终 assistant message 同时包含文本和 toolCall
})
```

### 验收标准

- [ ] 流式显示文本不丢失
- [ ] 历史记录中保留 tool call 前文本
- [ ] 下一轮传给模型的上下文完整

---

## 5. 明确未知 `sessionId` 的 API 行为

### 问题描述

当前 `/api/chat` 可能要求必须传 `sessionId`，但收到任意合法字符串时仍会：

```ts
getOrCreateAgent(sessionId)
```

这导致 API 语义不一致：

```text
文档：先 POST /api/sessions 创建会话
真实行为：直接传任意 ID 也会创建会话
```

### 推荐方案

采用严格模式：

```ts
const agent = sessionManager.getAgent(sessionId)

if (!agent) {
  reply.status(404)
  return {
    error: 'Session not found',
    code: 'SESSION_NOT_FOUND',
  }
}
```

会话只能通过：

```text
POST /api/sessions
```

创建。

### 需要检查的文件

```text
playground/backend/src/api/routes.ts
playground/frontend/src/hooks/useAgent.ts
README.md
```

### 必补测试

```text
1. 不传 sessionId → 400
2. 传不存在的 sessionId → 404
3. 先创建 session 再聊天 → 成功
4. TTL 到期后继续聊天 → 404
```

### 验收标准

- [ ] API 行为和 README 一致
- [ ] 不存在 sessionId 返回 404
- [ ] 前端可以正常自动创建 session

---

## 6. Fastify 关闭时释放 `SessionManager`

### 问题描述

`SessionManager` 内部存在：

```ts
setInterval(...)
```

虽然已经提供：

```ts
dispose()
```

但如果服务关闭时没有调用，测试和优雅停机时可能残留 timer。

### 修改建议

```ts
app.addHook('onClose', async () => {
  sessionManager.dispose()
})
```

或者：

```ts
this.cleanupTimer.unref()
```

建议两者都做。

### 需要检查的文件

```text
playground/backend/src/api/routes.ts
playground/backend/src/session/session-manager.ts
playground/backend/src/index.ts
```

### 必补测试

```ts
it('should dispose cleanup timer on server close', async () => {
  // 启动 app
  // close app
  // 断言 dispose 被调用
})
```

### 验收标准

- [ ] Fastify close 后 timer 被释放
- [ ] 测试进程可以自然退出
- [ ] 不出现悬挂 handle

---

## 7. 前端统一检查 `response.ok`

### 问题描述

前端多个 fetch 调用如果不检查：

```ts
response.ok
```

会导致：

```text
400 JSON 错误
→ 被当成 SSE 或正常 JSON 继续解析
→ 用户看不到明确提示
```

### 修改目标

封装统一 HTTP 错误处理。

### 推荐实现

```ts
async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) return response

  const body = await response.json().catch(() => null)

  throw new Error(
    body?.error || `HTTP ${response.status}`
  )
}
```

使用：

```ts
const response = await fetch(...)
await ensureOk(response)
```

### 需要检查的文件

```text
playground/frontend/src/hooks/useAgent.ts
```

### 需要覆盖的请求

```text
POST /api/sessions
POST /api/chat
GET /api/history/:sessionId
POST /api/reset/:sessionId
GET /api/export/:sessionId
```

### 验收标准

- [ ] 400 / 404 / 500 都能显示明确错误
- [ ] `/api/chat` 返回 JSON 错误时不会继续按 SSE 解析
- [ ] 错误后 UI 恢复可操作状态

---

## 8. `message_end` 后清理前端映射 Map

### 问题描述

前端维护：

```ts
assistantMessageIds.current.set(event.messageId, uiMessageId)
```

如果结束后不删除，长对话中 Map 会持续增长。

### 修改建议

```ts
case 'message_end': {
  const uiMessageId = assistantMessageIds.current.get(event.messageId)

  // 更新最终内容

  assistantMessageIds.current.delete(event.messageId)
  break
}
```

### 需要检查的文件

```text
playground/frontend/src/hooks/useAgent.ts
```

### 验收标准

- [ ] 消息结束后映射被删除
- [ ] 流式输出仍正常
- [ ] 多消息连续输出不受影响

---

# 四、P2：CI 和测试完善

## 9. Example CI 不要使用空操作

### 问题描述

CI 当前可能执行：

```bash
npm run build --if-present
```

但 `examples/01-manual-loop/package.json` 没有 `build` 脚本，因此不会真正检查 example。

### 修改建议

给 example 增加：

```json
{
  "scripts": {
    "start": "tsx index.ts",
    "typecheck": "tsc --noEmit"
  }
}
```

增加必要依赖：

```json
{
  "devDependencies": {
    "typescript": "^5.0.0",
    "tsx": "^4.0.0"
  }
}
```

CI 改成：

```yaml
- name: Example typecheck and run
  working-directory: examples/01-manual-loop
  run: |
    npm ci
    npm run typecheck
    npm run start
```

如果 example 需要 API Key，增加 Mock 模式或仅做 typecheck。

### 验收标准

- [ ] example 有真实 typecheck
- [ ] CI 不再空跑
- [ ] example 可以在无 API Key 模式下完成冒烟验证，或明确只做 typecheck

---

## 10. 补齐边界测试

### 状态

- [ ] 待处理

### Backend 核心测试

新增：

```text
1. 第 maxTurns 轮正常完成 → success
2. 第 maxTurns 轮仍调用工具 → MAX_TURNS_EXCEEDED
3. maxMessages 超限后裁剪
4. 裁剪后不存在孤立 toolResult
5. UTF-8 中文被拆分 chunk 后正常解码
6. tool call 前文本保留
7. 不存在 sessionId → 404
8. TTL 到期后 session → 404
9. LRU 淘汰后旧 session → 404
10. app.close() 后 timer 释放
```

### Frontend 测试

建议补：

```text
1. message_update 按 messageId 更新正确气泡
2. message_end 后 Map 清理
3. HTTP 400 时显示错误
4. HTTP 404 时显示 session 已失效
5. chat 返回 JSON 错误时不进入 SSE parser
```

---

# 五、推荐修改顺序

## 第一批：立即修复

- [ ] 1. `maxTurns` 边界误判
- [ ] 2. `maxMessages` 真正生效
- [ ] 3. UTF-8 流式解码

## 第二批：上下文和 API 一致性

- [ ] 4. 保留 tool call 前文本
- [ ] 5. 未知 sessionId 返回 404
- [ ] 6. SessionManager 生命周期释放

## 第三批：前端体验

- [ ] 7. 前端统一检查 `response.ok`
- [ ] 8. `message_end` 清理映射 Map

## 第四批：自动化验证

- [ ] 9. example CI 真正 typecheck / 冒烟测试
- [ ] 10. 补齐边界测试

---

# 六、建议验收命令

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
find dist -type f | sort
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

# 七、手工验收清单

## Agent Loop

- [ ] 第 `maxTurns` 轮正常结束返回 success
- [ ] 超出最大轮数时返回明确错误
- [ ] maxMessages 限制真实生效
- [ ] 裁剪后不存在孤立 toolResult

## OpenAI 流

- [ ] 中文跨 chunk 不乱码
- [ ] 英文流式输出正常
- [ ] tool call arguments 分片仍能正确拼接
- [ ] tool call 前文本保存在历史中

## Session

- [ ] 不传 sessionId 返回 400
- [ ] 不存在 sessionId 返回 404
- [ ] 创建 session 后可以正常多轮对话
- [ ] TTL 到期后 session 被释放
- [ ] LRU 淘汰后旧 session 被释放
- [ ] Fastify close 后 timer 被释放

## Frontend

- [ ] HTTP 错误显示明确提示
- [ ] JSON 错误不会被当成 SSE 解析
- [ ] message_end 后 Map 被清理
- [ ] 错误后 UI 可以继续操作

## CI

- [ ] docs build 通过
- [ ] backend build 通过
- [ ] backend test 通过
- [ ] frontend build 通过
- [ ] example typecheck 通过
- [ ] example 冒烟运行通过或明确采用 Mock 模式

---

# 八、交付要求

请 Kimi Code 完成后输出：

```text
1. 修改文件列表
2. 每项问题的修复说明
3. 新增测试列表
4. 所有验收命令的真实输出摘要
5. CI 结果
6. 仍未完成的问题
```

不要只回复“已优化完成”。

必须给出：

```text
npm run docs:build
backend npm run build
backend npm test -- --run
frontend npm run build
example npm run typecheck
```

的真实执行结果。

---

# 九、完成记录模板

```md
## 修改项

- 编号：
- 问题：
- 修改文件：
- 修改说明：
- 新增测试：
- 执行命令：
- 测试结果：
- Commit：
- 是否完成：
- 备注：
```

---

# 十、本轮完成标准

完成后项目应达到：

```text
Agent Loop 边界正确
消息数量受控
中文流式输出稳定
工具调用上下文完整
Session API 语义一致
服务关闭无悬挂资源
前端错误可见
CI 真正验证 examples
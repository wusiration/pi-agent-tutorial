# pi-agent-tutorial 最终冻结前补丁清单

> 目标：完成最后一次小范围修补后冻结主功能，不再继续进行多轮大改。
>
> 适合直接交给 Kimi Code 执行。

---

## 一、处理原则

本轮只处理以下内容：

1. 真正按完整 turn 裁剪上下文
2. 修正 `Agent.abort()` 与 reset 生命周期
3. CI 不再吞掉 example 运行失败
4. 可选：处理 OpenAI 流结束时剩余 buffer

本轮完成后，建议停止继续优化边角问题，进入正常学习、演示和使用阶段。

---

# 二、P0：必须修复

## 1. 真正按完整 turn 裁剪上下文

### 状态

- [ ] 待处理

### 问题描述

当前 `trimMessagesByTurns()` 仍然主要依赖：

```ts
messages.slice(-maxMessages)
```

再对开头的 `toolResult` 做有限修正。

这不能保证上下文从完整 user turn 开始，可能出现：

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

### 修改目标

按完整用户回合裁剪：

```text
user
assistant
assistant(toolCall)
toolResult
assistant(final)
```

不要从中间截断。

### 推荐实现思路

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

  for (let index = turns.length - 1; index >= 0; index--) {
    const turn = turns[index]

    if (kept.length > 0 && kept.length + turn.length > maxMessages) {
      break
    }

    kept.unshift(...turn)
  }

  return kept
}
```

### 边界策略

如果最近一轮本身已经超过 `maxMessages`，优先保留完整最近一轮，即允许短暂超过限制。

### 修改文件

```text
playground/backend/src/core/agent-loop.ts
playground/backend/src/core/agent-loop.test.ts
```

### 必补测试

```text
1. 普通聊天裁剪后第一条消息为 user
2. assistant(toolCall) 与 toolResult 不拆散
3. 最近一轮完整保留
4. 混合普通聊天与工具调用时裁剪正确
5. 最近单轮超过限制时行为明确
```

### 验收标准

- [ ] 不保留孤立 toolResult
- [ ] 不从半个 turn 开始
- [ ] 最近 turn 完整保留
- [ ] 裁剪策略有注释

---

## 2. 修正 `Agent.abort()` 与 reset 生命周期

### 状态

- [ ] 待处理

### 问题描述

当前 `Agent.prompt()` 在收到外部 signal 时，内部 controller 可能为 `null`，并覆盖 Agent 当前保存的 controller。

结果是：

```text
API 路由主动 abort 仍可能有效
但 SessionManager.delete()
TTL 淘汰
reset
Agent.abort()
```

在部分路径下不能可靠中止当前任务。

此外，reset 活跃 session 时，如果直接：

```ts
agent.reset()
```

会清空上下文并将 `_isStreaming` 设为 `false`，但旧任务可能仍在运行。

### 修改目标

统一 AbortController 所有权：

```text
Agent 自己持有内部 controller
外部 signal 只是额外中止来源
reset 活跃任务时明确拒绝
```

### 推荐实现

#### Agent.prompt()

```ts
async prompt(
  message: string | Message,
  options?: { useMock?: boolean; signal?: AbortSignal }
): Promise<void> {
  if (this._isStreaming) {
    throw new Error('Agent is already streaming')
  }

  this._isStreaming = true

  const controller = new AbortController()
  this.abortController = controller

  const signal = mergeAbortSignals(
    controller.signal,
    options?.signal
  )

  try {
    await runAgentLoop(
      [userMessage],
      this.context,
      { useMock: options?.useMock },
      (event) => this.emit(event),
      signal
    )
  } finally {
    if (this.abortController === controller) {
      this.abortController = null
    }

    this._isStreaming = false
  }
}
```

#### mergeAbortSignals()

```ts
function mergeAbortSignals(
  internalSignal: AbortSignal,
  externalSignal?: AbortSignal
): AbortSignal {
  if (!externalSignal) return internalSignal

  const controller = new AbortController()

  const abort = () => controller.abort()

  if (internalSignal.aborted || externalSignal.aborted) {
    controller.abort()
    return controller.signal
  }

  internalSignal.addEventListener('abort', abort, { once: true })
  externalSignal.addEventListener('abort', abort, { once: true })

  return controller.signal
}
```

也可以使用运行环境支持的 `AbortSignal.any()`。

#### reset 路由

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

### 修改文件

```text
playground/backend/src/core/agent.ts
playground/backend/src/api/routes.ts
playground/backend/src/session/session-manager.ts
playground/backend/src/core/agent.test.ts
playground/backend/src/api/routes.test.ts
```

### 必补测试

```text
1. agent.abort() 可以中止未传外部 signal 的 prompt
2. agent.abort() 可以中止传入外部 signal 的 prompt
3. reset 活跃 session 返回 409
4. reset 不存在 session 返回 404
5. reset 空闲 session 返回 success
6. TTL 淘汰活跃 Agent 时可以中止任务
```

### 验收标准

- [ ] Agent 独立使用时 abort 有效
- [ ] API 请求断开时 abort 有效
- [ ] TTL 淘汰时 abort 有效
- [ ] reset 不会制造并发 Loop
- [ ] prompt 结束后 controller 被清理

---

## 3. CI 不再吞掉 example 运行失败

### 状态

- [ ] 待处理

### 问题描述

当前 CI 中 example 冒烟运行如果使用：

```bash
timeout 10s npm run start || true
```

则任何运行错误都会被吞掉，CI 仍然返回成功。

### 修改目标

example 报错时 CI 必须失败。

### 推荐实现

如果 example 可以自然退出，直接：

```yaml
- name: Example typecheck and smoke test
  working-directory: examples/01-manual-loop
  run: |
    npm ci
    npm run typecheck
    npm run start
```

如果确实需要 timeout：

```yaml
- name: Example smoke test
  working-directory: examples/01-manual-loop
  run: |
    timeout 10s npm run start
```

不要加：

```bash
|| true
```

### 修改文件

```text
.github/workflows/ci.yml
```

### 验收标准

- [ ] example 正常运行时 CI 通过
- [ ] example 主动抛错时 CI 失败
- [ ] example 卡死时 timeout 触发失败
- [ ] 不再使用 `|| true`

---

# 三、P1：建议顺手修复

## 4. OpenAI 流结束时处理剩余 buffer

### 状态

- [ ] 可选优化

### 问题描述

后端 OpenAI 流读取结束时，如果只执行：

```ts
buffer += decoder.decode()
break
```

则剩余 buffer 没有再次被解析。

标准 SSE 通常会包含尾随换行，因此多数情况下没问题。但如果最后一条事件没有尾随换行，可能丢失最后一条事件。

### 修改建议

抽取统一处理函数：

```ts
function processSSEBuffer(
  buffer: string,
  flush = false
): string {
  const lines = buffer.split('\n')
  const remaining = flush ? '' : lines.pop() || ''

  for (const line of lines) {
    if (!line.startsWith('data: ')) continue

    const data = line.slice(6)
    if (!data || data === '[DONE]') continue

    handleData(data)
  }

  if (flush && remaining.startsWith('data: ')) {
    const data = remaining.slice(6)
    if (data && data !== '[DONE]') {
      handleData(data)
    }
  }

  return remaining
}
```

循环结束时：

```ts
if (done) {
  buffer += decoder.decode()
  processSSEBuffer(buffer, true)
  break
}
```

### 修改文件

```text
playground/backend/src/llm/openai-client.ts
playground/backend/src/llm/openai-client.test.ts
```

### 必补测试

```text
1. 最后一条 SSE 事件无尾随换行仍能解析
2. UTF-8 中文跨 chunk 时正常
3. [DONE] 正常处理
```

---

# 四、推荐执行顺序

## 第一批

- [ ] 1. 真正按完整 turn 裁剪
- [ ] 2. 修正 Agent.abort() 与 reset 生命周期

## 第二批

- [ ] 3. CI 不再吞掉 example 失败

## 第三批

- [ ] 4. OpenAI 剩余 buffer 处理

---

# 五、验收命令

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

# 六、必须验证的手工场景

```text
1. 长对话裁剪后从完整 user turn 开始
2. 工具调用历史不会留下孤立 toolResult
3. reset 活跃 session 返回 409
4. reset 不存在 session 返回 404
5. agent.abort() 可中止运行中任务
6. TTL 淘汰活跃 Agent 时任务停止
7. example 报错时 CI 失败
8. 最后一条 SSE 没有尾随换行时仍可解析
```

---

# 七、交付要求

请 Kimi Code 完成后输出：

```text
1. 修改文件列表
2. 每项修复说明
3. 新增测试列表
4. 以下命令真实输出摘要：
   - npm run docs:build
   - backend npm run build
   - backend npm test -- --run
   - frontend npm run build
   - example npm run typecheck
   - example npm run start
5. GitHub Actions 运行结果
6. 是否仍有未处理问题
```

不要只回复：

```text
已优化完成
```

---

# 八、冻结标准

以下条件全部满足后，即可停止继续调整：

```text
上下文按完整 turn 裁剪
AbortController 生命周期统一
reset 活跃 session 不产生竞态
CI 不吞掉 example 运行失败
OpenAI 流结束边界稳健
backend build/test 通过
frontend build 通过
example typecheck/start 通过
docs build 通过
GitHub Actions 全绿
```

完成本清单后，建议冻结主功能，进入正式使用和学习阶段。


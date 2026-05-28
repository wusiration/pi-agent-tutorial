# 03 后端：Agent Core

> 这一章实现 Agent 的核心机制：类型定义、工具注册表、Agent Loop 和 Agent 类。这是整个项目最重要的部分。

## 文件 1：core/types.ts

先定义核心类型。我们简化 Pi 的类型系统，保留核心形状：

```ts
// backend/src/core/types.ts
import type {
  Message,
  ToolDefinition,
  ToolResult,
  AgentEvent,
} from '../../../shared/types.js'

export { Message, ToolDefinition, ToolResult, AgentEvent }

export interface AgentTool extends ToolDefinition {
  execute: (
    toolCallId: string,
    params: Record<string, any>,
    signal?: AbortSignal,
    onUpdate?: (partial: ToolResult) => void
  ) => Promise<ToolResult>
  executionMode?: 'sequential' | 'parallel'
}

export interface AgentContext {
  systemPrompt: string
  messages: Message[]
  tools: AgentTool[]
}

export interface AgentState {
  systemPrompt: string
  messages: Message[]
  tools: AgentTool[]
  isStreaming: boolean
  streamingMessage?: Message
}

export interface AgentOptions {
  initialState: Partial<AgentState>
  toolExecution?: 'sequential' | 'parallel'
}

export type AgentEventListener = (event: AgentEvent) => void | Promise<void>
```

## 文件 2：core/tool-registry.ts

```ts
// backend/src/core/tool-registry.ts
import type { AgentTool } from './types.js'

export class ToolRegistry {
  private tools = new Map<string, AgentTool>()

  register(tool: AgentTool) {
    this.tools.set(tool.name, tool)
  }

  get(name: string): AgentTool | undefined {
    return this.tools.get(name)
  }

  getAll(): AgentTool[] {
    return Array.from(this.tools.values())
  }

  getDefinitions(): ToolDefinition[] {
    return this.getAll().map((t) => ({
      name: t.name,
      label: t.label,
      description: t.description,
      parameters: t.parameters,
    }))
  }
}
```

## 文件 3：llm/mock-client.ts

先实现 Mock LLM，这样不需要 API key 也能测试：

```ts
// backend/src/llm/mock-client.ts
import type { Message, AgentEvent } from '../../shared/types.js'

export interface MockLLMOptions {
  onEvent: (event: AgentEvent) => void
}

export async function mockStream(
  messages: Message[],
  tools: any[],
  options: MockLLMOptions,
  signal?: AbortSignal
): Promise<void> {
  const lastUserMessage = messages.findLast((m) => m.role === 'user')
  const text = lastUserMessage?.content || 'Hello'

  // 模拟思考延迟
  await delay(300)

  // 模拟工具调用检测
  const shouldCallTool = text.includes('weather') || text.includes('calculate')

  if (shouldCallTool && tools.length > 0) {
    const tool = tools[0]
    const toolCallId = `mock-call-${Date.now()}`

    // 发送 assistant 消息（包含 toolCall）
    const assistantMsg: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: 'I will help you with that.' },
        { type: 'toolCall', id: toolCallId, name: tool.name, arguments: { city: 'Beijing' } },
      ],
      stopReason: 'toolUse',
      timestamp: Date.now(),
    }

    options.onEvent({ type: 'message_start', message: assistantMsg })
    options.onEvent({ type: 'message_update', message: assistantMsg, delta: 'I will help you with that.' })
    options.onEvent({ type: 'message_end', message: assistantMsg })

    return
  }

  // 普通文本回复
  const reply = `Mock response to: "${text}"`
  const assistantMsg: Message = {
    role: 'assistant',
    content: [{ type: 'text', text: reply }],
    stopReason: 'stop',
    timestamp: Date.now(),
  }

  options.onEvent({ type: 'message_start', message: assistantMsg })

  // 逐字输出
  for (let i = 0; i < reply.length; i++) {
    if (signal?.aborted) break
    await delay(30)
    options.onEvent({ type: 'message_update', message: assistantMsg, delta: reply[i] })
  }

  options.onEvent({ type: 'message_end', message: assistantMsg })
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
```

## 文件 4：llm/openai-client.ts

```ts
// backend/src/llm/openai-client.ts
import type { Message, AgentEvent } from '../../shared/types.js'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'

export async function openaiStream(
  messages: Message[],
  tools: any[],
  options: { onEvent: (event: AgentEvent) => void },
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: convertMessages(messages),
      tools: tools.length > 0 ? tools.map(convertTool) : undefined,
      tool_choice: tools.length > 0 ? 'auto' : undefined,
      stream: true,
    }),
    signal,
  })

  if (!response.ok) {
    throw new Error(`OpenAI API error: ${response.status} ${await response.text()}`)
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body')

  let buffer = ''
  let currentMessage: Message | null = null

  while (true) {
    const { done, value } = await reader.read()
    if (done) break

    buffer += new TextDecoder().decode(value)
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue

      try {
        const chunk = JSON.parse(data)
        const delta = chunk.choices?.[0]?.delta
        if (!delta) continue

        if (chunk.choices[0].finish_reason === 'tool_calls') {
          // 工具调用结束，已在之前构建
          continue
        }

        if (delta.content) {
          if (!currentMessage) {
            currentMessage = {
              role: 'assistant',
              content: [{ type: 'text', text: '' }],
              stopReason: 'stop',
              timestamp: Date.now(),
            }
            options.onEvent({ type: 'message_start', message: currentMessage })
          }
          currentMessage.content[0].text += delta.content
          options.onEvent({ type: 'message_update', message: currentMessage, delta: delta.content })
        }

        if (delta.tool_calls) {
          // 简化处理：假设只有一个 tool call
          const tc = delta.tool_calls[0]
          if (!currentMessage) {
            currentMessage = {
              role: 'assistant',
              content: [],
              stopReason: 'toolUse',
              timestamp: Date.now(),
            }
            options.onEvent({ type: 'message_start', message: currentMessage })
          }

          const existing = currentMessage.content.find((c) => c.type === 'toolCall' && c.id === tc.id)
          if (existing && tc.function?.arguments) {
            existing.arguments = JSON.parse(tc.function.arguments)
          } else if (tc.function) {
            currentMessage.content.push({
              type: 'toolCall',
              id: tc.id,
              name: tc.function.name || '',
              arguments: tc.function.arguments ? JSON.parse(tc.function.arguments) : {},
            })
          }
        }
      } catch {
        // ignore parse errors
      }
    }
  }

  if (currentMessage) {
    options.onEvent({ type: 'message_end', message: currentMessage })
  }
}

function convertMessages(messages: Message[]): any[] {
  return messages.map((m) => {
    if (m.role === 'user') {
      return { role: 'user', content: m.content }
    }
    if (m.role === 'assistant') {
      return {
        role: 'assistant',
        content: m.content.filter((c) => c.type === 'text').map((c) => c.text).join('') || null,
        tool_calls: m.content.filter((c) => c.type === 'toolCall').map((c) => ({
          id: c.id,
          type: 'function',
          function: { name: c.name, arguments: JSON.stringify(c.arguments) },
        })),
      }
    }
    if (m.role === 'toolResult') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content.map((c) => c.text).join(''),
      }
    }
    return m
  })
}

function convertTool(tool: any): any {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}
```

## 文件 5：core/agent-loop.ts

这是核心中的核心：

```ts
// backend/src/core/agent-loop.ts
import type { Message, ToolResultMessage, AgentEvent } from '../../shared/types.js'
import type { AgentContext, AgentTool } from './types.js'
import { mockStream } from '../llm/mock-client.js'
import { openaiStream } from '../llm/openai-client.js'

export interface LoopConfig {
  useMock?: boolean
  toolExecution?: 'sequential' | 'parallel'
}

export async function runAgentLoop(
  userMessages: Message[],
  context: AgentContext,
  config: LoopConfig,
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal
): Promise<Message[]> {
  const newMessages: Message[] = [...userMessages]

  emit({ type: 'agent_start' })

  // 添加用户消息到上下文
  for (const msg of userMessages) {
    context.messages.push(msg)
    emit({ type: 'message_start', message: msg })
    emit({ type: 'message_end', message: msg })
  }

  let turnCount = 0
  const maxTurns = 10

  while (turnCount < maxTurns) {
    if (signal?.aborted) break
    turnCount++

    emit({ type: 'turn_start' })

    // 调用 LLM
    const assistantMsg = await callLLM(context, config, emit, signal)
    if (!assistantMsg) break

    context.messages.push(assistantMsg)
    newMessages.push(assistantMsg)

    // 检查是否有工具调用
    const toolCalls = assistantMsg.content.filter((c) => c.type === 'toolCall')
    if (toolCalls.length === 0) {
      emit({ type: 'turn_end', message: assistantMsg, toolResults: [] })
      break
    }

    // 执行工具
    const toolResults: ToolResultMessage[] = []

    if (config.toolExecution === 'parallel') {
      const promises = toolCalls.map(async (tc) => {
        return executeTool(tc.id, tc.name, tc.arguments, context.tools, emit, signal)
      })
      const results = await Promise.all(promises)
      toolResults.push(...results)
    } else {
      for (const tc of toolCalls) {
        const result = await executeTool(tc.id, tc.name, tc.arguments, context.tools, emit, signal)
        toolResults.push(result)
      }
    }

    // 添加工具结果到上下文
    for (const tr of toolResults) {
      context.messages.push(tr)
      newMessages.push(tr)
    }

    emit({ type: 'turn_end', message: assistantMsg, toolResults })
  }

  emit({ type: 'agent_end', messages: context.messages })
  return newMessages
}

async function callLLM(
  context: AgentContext,
  config: LoopConfig,
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal
): Promise<Message | null> {
  let currentMsg: Message | null = null

  const onEvent = (event: AgentEvent) => {
    emit(event)
    if (event.type === 'message_start') {
      currentMsg = event.message
    }
  }

  if (config.useMock) {
    await mockStream(context.messages, context.tools, { onEvent }, signal)
  } else {
    await openaiStream(context.messages, context.tools, { onEvent }, signal)
  }

  return currentMsg
}

async function executeTool(
  toolCallId: string,
  toolName: string,
  args: Record<string, any>,
  tools: AgentTool[],
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal
): Promise<ToolResultMessage> {
  const tool = tools.find((t) => t.name === toolName)

  emit({ type: 'tool_execution_start', toolCallId, toolName, args })

  if (!tool) {
    const errorResult: ToolResultMessage = {
      role: 'toolResult',
      toolCallId,
      toolName,
      content: [{ type: 'text', text: `Tool not found: ${toolName}` }],
      isError: true,
      timestamp: Date.now(),
    }
    emit({ type: 'tool_execution_end', toolCallId, toolName, result: { content: errorResult.content }, isError: true })
    return errorResult
  }

  try {
    const onUpdate = (partial: any) => {
      emit({ type: 'tool_execution_update', toolCallId, partialResult: partial })
    }

    const result = await tool.execute(toolCallId, args, signal, onUpdate)

    const toolResult: ToolResultMessage = {
      role: 'toolResult',
      toolCallId,
      toolName,
      content: result.content,
      isError: false,
      timestamp: Date.now(),
    }

    emit({ type: 'tool_execution_end', toolCallId, toolName, result, isError: false })
    return toolResult
  } catch (error: any) {
    const toolResult: ToolResultMessage = {
      role: 'toolResult',
      toolCallId,
      toolName,
      content: [{ type: 'text', text: error.message || 'Unknown error' }],
      isError: true,
      timestamp: Date.now(),
    }

    emit({ type: 'tool_execution_end', toolCallId, toolName, result: { content: toolResult.content }, isError: true })
    return toolResult
  }
}
```

## 文件 6：core/agent.ts

```ts
// backend/src/core/agent.ts
import type { Message, AgentEvent } from '../../shared/types.js'
import type { AgentContext, AgentState, AgentOptions, AgentEventListener } from './types.js'
import { runAgentLoop } from './agent-loop.js'

export class Agent {
  private context: AgentContext
  private listeners: AgentEventListener[] = []
  private _isStreaming = false

  constructor(options: AgentOptions) {
    this.context = {
      systemPrompt: options.initialState.systemPrompt || 'You are a helpful assistant.',
      messages: options.initialState.messages || [],
      tools: options.initialState.tools || [],
    }
  }

  get state(): AgentState {
    return {
      systemPrompt: this.context.systemPrompt,
      messages: this.context.messages,
      tools: this.context.tools,
      isStreaming: this._isStreaming,
    }
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  private emit(event: AgentEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (e) {
        console.error('Event listener error:', e)
      }
    }
  }

  async prompt(message: string | Message, options?: { useMock?: boolean }): Promise<void> {
    if (this._isStreaming) {
      throw new Error('Agent is already streaming')
    }

    this._isStreaming = true
    const userMsg: Message =
      typeof message === 'string'
        ? { role: 'user', content: message, timestamp: Date.now() }
        : message

    try {
      await runAgentLoop(
        [userMsg],
        this.context,
        { useMock: options?.useMock, toolExecution: 'parallel' },
        (event) => this.emit(event)
      )
    } finally {
      this._isStreaming = false
    }
  }

  reset() {
    this.context.messages = []
    this._isStreaming = false
  }
}
```

## 内置工具定义

```ts
// backend/src/core/builtin-tools.ts
import type { AgentTool } from './types.js'

export const weatherTool: AgentTool = {
  name: 'weather',
  label: '天气查询',
  description: '查询指定城市的当前天气',
  parameters: {
    type: 'object',
    properties: {
      city: { type: 'string', description: '城市名称' },
    },
    required: ['city'],
  },
  execute: async (id, params) => {
    // Mock 实现
    const conditions = ['晴天', '多云', '小雨', '大雨']
    const condition = conditions[Math.floor(Math.random() * conditions.length)]
    const temp = Math.floor(Math.random() * 20) + 10
    return {
      content: [{ type: 'text', text: `${params.city}当前天气：${condition}，${temp}°C` }],
      details: { source: 'mock' },
    }
  },
}

export const calculatorTool: AgentTool = {
  name: 'calculator',
  label: '计算器',
  description: '执行数学计算',
  parameters: {
    type: 'object',
    properties: {
      expression: { type: 'string', description: '数学表达式，如 2 + 2' },
    },
    required: ['expression'],
  },
  execute: async (id, params) => {
    try {
      // 注意：生产环境不要用 eval
      const result = Function('"use strict"; return (' + params.expression + ')')()
      return {
        content: [{ type: 'text', text: String(result) }],
        details: {},
      }
    } catch (e: any) {
      throw new Error(`计算错误: ${e.message}`)
    }
  },
}

export const searchTool: AgentTool = {
  name: 'search',
  label: '搜索',
  description: '搜索信息',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: '搜索关键词' },
    },
    required: ['query'],
  },
  execute: async (id, params) => {
    return {
      content: [{ type: 'text', text: `搜索结果：关于"${params.query}"找到 3 条结果...` }],
      details: {},
    }
  },
}
```

## 本章小结

- `types.ts` 定义了简化但完整的核心类型。
- `mock-client.ts` 让你无需 API key 就能测试。
- `openai-client.ts` 实现了 OpenAI 兼容的流式调用。
- `agent-loop.ts` 是核心循环，处理 LLM 调用 → 工具执行 → 结果回传。
- `agent.ts` 提供高层封装，管理状态和事件订阅。

## 测试

```bash
cd backend
npm run dev
```

在另一个终端测试：

```bash
curl -X POST http://localhost:3000/api/chat \
  -H "Content-Type: application/json" \
  -d '{"message":"Hello","useMock":true}'
```

> 注意：此时还没有 HTTP 路由，下一章会添加。你可以先写一个简单的测试脚本来验证 Agent 类。

## 小练习

1. 在 `agent-loop.ts` 的 `while` 循环里添加日志，观察一次带工具调用的对话会循环几轮。
2. 修改 `mockStream`，让它在检测到 "error" 关键词时返回 `isError: true` 的工具结果，观察 Agent 如何处理。
3. 实现一个 `timer` 工具，接收 `seconds` 参数，用 `setTimeout` 延迟后返回 "Done"，并用 `onUpdate` 每秒报告进度。

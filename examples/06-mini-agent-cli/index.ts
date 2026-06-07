/**
 * ============================================================================
 * Capstone: Mini Agent CLI — Interactive Command-Line Agent
 * ============================================================================
 *
 * Combines every concept from the previous tutorials:
 *   • Mock LLM with tool support        (from 02-tool-calls)
 *   • Event-driven streaming output     (from 03-event-stream)
 *   • Session management & history      (from 04-session-context)
 *   • AbortController for cancellation  (from 05-session-manager)
 *   • Interactive readline loop         (new)
 *
 * Commands:
 *   <text>   → send to Agent
 *   /reset   → clear session
 *   /abort   → cancel in-flight request
 *   /history → print message history
 *   /quit    → exit
 *
 * Run: npm install && npm start
 * ============================================================================
 */

import { createInterface } from 'node:readline'
import { stdin as input, stdout as output } from 'node:process'
import { Type } from '@sinclair/typebox'

// ============================================
// Types
// ============================================

interface TextContent { type: 'text'; text: string }

interface ToolCallContent {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, unknown>
}

type Content = TextContent | ToolCallContent

interface UserMessage { role: 'user'; content: string; timestamp: number }

interface AssistantMessage {
  role: 'assistant'
  content: Content[]
  stopReason: 'stop' | 'toolUse'
  timestamp: number
}

interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: TextContent[]
  isError: boolean
  timestamp: number
}

type Message = UserMessage | AssistantMessage | ToolResultMessage

interface Tool {
  name: string
  description: string
  parameters: unknown
  execute: (id: string, params: Record<string, unknown>) => Promise<{ content: TextContent[] }>
}

interface Session {
  id: string
  systemPrompt: string
  messages: Message[]
  tools: Tool[]
}

// ============================================
// Mock LLM (no API key needed)
// ============================================

async function mockLLM(session: Session, signal?: AbortSignal): Promise<AssistantMessage> {
  await delay(400, signal)

  const last = session.messages.at(-1)

  // If last message was a tool result, synthesise a final answer.
  if (last?.role === 'toolResult') {
    const tr = last as ToolResultMessage
    return {
      role: 'assistant',
      content: [{ type: 'text', text: `根据查询结果：${tr.content[0].text}` }],
      stopReason: 'stop',
      timestamp: Date.now(),
    }
  }

  const userText = session.messages.findLast((m) => m.role === 'user')?.content ?? ''

  // Keyword-based routing (simulates an LLM deciding to call tools).
  if (userText.includes('天气')) {
    const city = userText.match(/(.+?)(?:的)?天气/)?.[1]?.trim() || '北京'
    return {
      role: 'assistant',
      content: [
        { type: 'text', text: `我来查询 ${city} 的天气。` },
        { type: 'toolCall', id: `call-${Date.now()}`, name: 'weather', arguments: { city } },
      ],
      stopReason: 'toolUse',
      timestamp: Date.now(),
    }
  }

  if (userText.includes('计算') || /[\d+\-*/]/.test(userText)) {
    const expr = userText.match(/([\d\s+\-*/().]+)/)?.[1]?.trim() || '1 + 1'
    return {
      role: 'assistant',
      content: [
        { type: 'text', text: `我来计算 ${expr}。` },
        { type: 'toolCall', id: `call-${Date.now()}`, name: 'calculator', arguments: { expression: expr } },
      ],
      stopReason: 'toolUse',
      timestamp: Date.now(),
    }
  }

  // Default text-only reply.
  return {
    role: 'assistant',
    content: [{ type: 'text', text: `Mock 回复：你说了 "${userText}"` }],
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

// ============================================
// Tools
// ============================================

const weatherTool: Tool = {
  name: 'weather',
  description: '查询指定城市的天气',
  parameters: Type.Object({ city: Type.String({ description: '城市名称' }) }),
  execute: async (_id, params) => {
    const city = String(params.city ?? '未知')
    const conditions = ['晴天', '多云', '小雨', '大雨']
    const cond = conditions[Math.floor(Math.random() * conditions.length)]
    const temp = Math.floor(Math.random() * 20) + 10
    return { content: [{ type: 'text', text: `${city}：${cond}，${temp}°C` }] }
  },
}

const calculatorTool: Tool = {
  name: 'calculator',
  description: '计算简单的数学表达式（支持 + - * /）',
  parameters: Type.Object({
    expression: Type.String({ description: '数学表达式，例如 "12 * 34"' }),
  }),
  execute: async (_id, params) => {
    const expr = String(params.expression ?? '')
    try {
      if (!/^[\d\s+\-*/().]+$/.test(expr)) throw new Error('Invalid characters')
      // eslint-disable-next-line no-eval
      const result = eval(expr)
      return { content: [{ type: 'text', text: `${expr} = ${result}` }] }
    } catch {
      return { content: [{ type: 'text', text: `无法计算：${expr}` }] }
    }
  },
}

// ============================================
// Session Helpers
// ============================================

function createSession(): Session {
  return {
    id: `session-${Date.now()}`,
    systemPrompt: 'You are a helpful assistant.',
    messages: [],
    tools: [weatherTool, calculatorTool],
  }
}

function resetSession(s: Session): void {
  s.messages = []
  s.id = `session-${Date.now()}`
}

// ============================================
// Streaming Output (typing effect)
// ============================================

async function streamText(text: string, chunkMs = 30): Promise<void> {
  for (const char of text) {
    output.write(char)
    await delay(chunkMs)
  }
  output.write('\n')
}

// ============================================
// Agent Turn (request → response loop)
// ============================================

async function runAgentTurn(input: string, session: Session, signal: AbortSignal): Promise<void> {
  // 1. Append user message.
  session.messages.push({ role: 'user', content: input, timestamp: Date.now() })

  // 2. Call LLM (respects abort).
  const assistant = await mockLLM(session, signal)
  session.messages.push(assistant)

  // 3. Stream text portions to terminal.
  for (const part of assistant.content.filter((c): c is TextContent => c.type === 'text')) {
    output.write('🤖 ')
    await streamText(part.text)
  }

  // 4. Execute any tool calls.
  const toolCalls = assistant.content.filter((c): c is ToolCallContent => c.type === 'toolCall')
  if (toolCalls.length === 0) return

  for (const tc of toolCalls) {
    if (signal.aborted) throw new Error('Aborted')

    const tool = session.tools.find((t) => t.name === tc.name)
    if (!tool) {
      output.write(`❌ 工具未找到: ${tc.name}\n`)
      continue
    }

    output.write(`🔧 执行工具: ${tc.name}(${JSON.stringify(tc.arguments)})\n`)
    const result = await tool.execute(tc.id, tc.arguments)

    session.messages.push({
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: result.content,
      isError: false,
      timestamp: Date.now(),
    })
    output.write(`📋 工具结果: ${result.content[0].text}\n`)
  }

  // 5. Let LLM react to tool results.
  const followUp = await mockLLM(session, signal)
  session.messages.push(followUp)

  for (const part of followUp.content.filter((c): c is TextContent => c.type === 'text')) {
    output.write('🤖 ')
    await streamText(part.text)
  }
}

// ============================================
// History Printer
// ============================================

function printHistory(session: Session): void {
  output.write('\n=== 消息历史 ===\n')
  for (const msg of session.messages) {
    if (msg.role === 'user') output.write(`👤 ${msg.content}\n`)
    else if (msg.role === 'assistant') {
      const text = msg.content.filter((c): c is TextContent => c.type === 'text').map((c) => c.text).join(' ')
      output.write(`🤖 ${text}\n`)
    } else if (msg.role === 'toolResult') {
      output.write(`📋 ${msg.content[0].text}\n`)
    }
  }
  output.write('================\n\n')
}

// ============================================
// Utility
// ============================================

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    })
  })
}

// ============================================
// Main CLI Loop
// ============================================

async function main(): Promise<void> {
  const session = createSession()
  let abortCtrl: AbortController | null = null
  let inFlight = false

  const rl = createInterface({ input, output, prompt: '> ' })

  output.write('============================================\n')
  output.write('  🚀 Mini Agent CLI (Capstone Example)\n')
  output.write('============================================\n')
  output.write('Commands: <text>  /reset  /abort  /history  /quit\n\n')

  // Use an async iterator so each line is processed sequentially.
  for await (const line of rl) {
    const raw = line.trim()

    if (raw === '/quit') {
      output.write('👋 Goodbye!\n')
      rl.close()
      break
    }

    if (raw === '/reset') {
      resetSession(session)
      output.write('🗑️  Session cleared.\n\n')
      continue
    }

    if (raw === '/abort') {
      if (inFlight) {
        abortCtrl!.abort()
        output.write('⏹️  Request aborted.\n\n')
      } else {
        output.write('ℹ️  No request in flight.\n\n')
      }
      continue
    }

    if (raw === '/history') {
      printHistory(session)
      continue
    }

    if (raw === '') {
      continue
    }

    // Normal message — run an Agent turn with cancellation support.
    abortCtrl = new AbortController()
    inFlight = true
    try {
      await runAgentTurn(raw, session, abortCtrl.signal)
      output.write('\n')
    } catch (err: any) {
      output.write(err.message === 'Aborted' ? '⏹️  Turn was aborted.\n\n' : `❌ Error: ${err.message}\n\n`)
    } finally {
      inFlight = false
      abortCtrl = null
    }
  }

  output.write('\n')
  process.exit(0)
}

main().catch(console.error)

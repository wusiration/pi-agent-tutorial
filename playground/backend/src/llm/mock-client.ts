import type { Message, AgentEvent, ToolDefinition, TextContent } from '../../../shared/types.js'

export interface MockLLMOptions {
  onEvent: (event: AgentEvent) => void
}

export async function mockStream(
  messages: Message[],
  tools: ToolDefinition[],
  options: MockLLMOptions,
  signal?: AbortSignal
): Promise<void> {
  const lastUserMessage = messages.findLast((m): m is Message & { role: 'user' } => m.role === 'user')
  const text = typeof lastUserMessage?.content === 'string'
    ? lastUserMessage.content
    : lastUserMessage?.content?.find((c): c is TextContent => c.type === 'text')?.text || ''

  // 模拟思考延迟
  await delay(300, signal)

  // 检测是否应该调用工具
  const shouldCallTool = tools.length > 0 && (
    text.includes('天气') ||
    text.includes('计算') ||
    text.includes('search') ||
    text.includes('搜索')
  )

  const messageId = `msg-${Date.now()}`

  if (shouldCallTool) {
    // 匹配工具
    const matchedTool = tools.find((t) =>
      text.includes(t.name) ||
      (t.name === 'weather' && text.includes('天气')) ||
      (t.name === 'calculator' && /\d+\s*[+\-*/]\s*\d+/.test(text))
    ) || tools[0]

    const toolCallId = `call-${Date.now()}`

    // 构造 assistant 消息（包含 toolCall）
    const assistantMsg: Message = {
      role: 'assistant',
      content: [
        { type: 'text', text: '我来帮您处理这个请求。' },
        {
          type: 'toolCall',
          id: toolCallId,
          name: matchedTool.name,
          arguments: matchedTool.name === 'weather'
            ? { city: extractCity(text) || '北京' }
            : matchedTool.name === 'calculator'
            ? { expression: extractExpression(text) || '1+1' }
            : { query: text },
        },
      ],
      stopReason: 'toolUse',
      timestamp: Date.now(),
    }

    options.onEvent({ type: 'message_start', message: assistantMsg })
    options.onEvent({ type: 'message_update', messageId, delta: '我来帮您处理这个请求。' })
    options.onEvent({ type: 'message_end', messageId, message: assistantMsg })
    return
  }

  // 普通文本回复
  const reply = `这是 Mock 回复：您说的是 "${text}"`
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
    await delay(30, signal)
    options.onEvent({ type: 'message_update', messageId, delta: reply[i] })
  }

  options.onEvent({ type: 'message_end', messageId, message: assistantMsg })
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new Error('Aborted'))
      return
    }
    const timer = setTimeout(resolve, ms)
    signal?.addEventListener('abort', () => {
      clearTimeout(timer)
      reject(new Error('Aborted'))
    })
  })
}

function extractCity(text: string): string | null {
  const match = text.match(/(.+?)(?:的)?天气/)
  return match ? match[1].trim() : null
}

function extractExpression(text: string): string | null {
  const match = text.match(/(\d+[\s+\-*/().\d]*)/)
  return match ? match[1].replace(/\s/g, '') : null
}

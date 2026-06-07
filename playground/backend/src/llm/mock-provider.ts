import type { Message, AgentEvent, ToolDefinition, TextContent } from '../../../shared/types.js'
import type { LLMProvider } from './provider.js'

export class MockProvider implements LLMProvider {
  async stream(
    messages: Message[],
    tools: ToolDefinition[],
    options: { onEvent: (event: AgentEvent) => void },
    signal?: AbortSignal
  ): Promise<void> {
    const messageId = `msg-${Date.now()}`

    // 模拟思考延迟
    await delay(300, signal)

    // 获取最后一条消息，判断当前状态
    const lastMessage = messages.at(-1)

    // 状态 1：最后一条是 toolResult → 生成最终回答，不再调用工具
    if (lastMessage?.role === 'toolResult') {
      const toolName = lastMessage.toolName
      const toolResult = lastMessage.content
        .filter((c): c is TextContent => c.type === 'text')
        .map((c) => c.text)
        .join('')

      const reply = `根据工具执行结果，${toolName} 返回了：${toolResult}`
      const assistantMsg: Message = {
        role: 'assistant',
        content: [{ type: 'text', text: reply }],
        stopReason: 'stop',
        timestamp: Date.now(),
      }

      options.onEvent({ type: 'message_start', messageId, message: assistantMsg })
      for (let i = 0; i < reply.length; i++) {
        if (signal?.aborted) break
        await delay(30, signal)
        options.onEvent({ type: 'message_update', messageId, delta: reply[i] })
      }
      options.onEvent({ type: 'message_end', messageId, message: assistantMsg })
      return
    }

    // 状态 2：最后一条是用户消息 → 判断是否需要调用工具
    const lastUserMessage = messages.findLast((m): m is Message & { role: 'user' } => m.role === 'user')
    const text = typeof lastUserMessage?.content === 'string'
      ? lastUserMessage.content
      : lastUserMessage?.content?.find((c): c is TextContent => c.type === 'text')?.text || ''

    // 检测是否应该调用工具
    const shouldCallTool = tools.length > 0 && (
      text.includes('天气') ||
      text.includes('计算') ||
      text.includes('calculate') ||
      text.includes('search') ||
      text.includes('搜索')
    )

    if (shouldCallTool) {
      // 匹配具体工具（优先精确匹配，避免 fallback 到 tools[0]）
      let matchedTool: ToolDefinition | undefined

      if (text.includes('天气') && tools.some((t) => t.name === 'weather')) {
        matchedTool = tools.find((t) => t.name === 'weather')
      } else if ((text.includes('计算') || text.includes('calculate')) && tools.some((t) => t.name === 'calculator')) {
        matchedTool = tools.find((t) => t.name === 'calculator')
      } else if ((text.includes('search') || text.includes('搜索')) && tools.some((t) => t.name === 'search')) {
        matchedTool = tools.find((t) => t.name === 'search')
      }

      // 如果精确匹配失败，再用模糊匹配（但不再 fallback 到 tools[0]）
      if (!matchedTool) {
        matchedTool = tools.find((t) =>
          text.includes(t.name) ||
          (t.name === 'weather' && text.includes('天气')) ||
          (t.name === 'calculator' && /\d+\s*[+\-*/]\s*\d+/.test(text))
        )
      }

      if (matchedTool) {
        const toolCallId = `call-${Date.now()}`

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

        options.onEvent({ type: 'message_start', messageId, message: assistantMsg })
        options.onEvent({ type: 'message_update', messageId, delta: '我来帮您处理这个请求。' })
        options.onEvent({ type: 'message_end', messageId, message: assistantMsg })
        return
      }
    }

    // 状态 3：普通文本回复（未命中工具或工具列表为空）
    const reply = `这是 Mock 回复：您说的是 "${text}"`
    const assistantMsg: Message = {
      role: 'assistant',
      content: [{ type: 'text', text: reply }],
      stopReason: 'stop',
      timestamp: Date.now(),
    }

    options.onEvent({ type: 'message_start', messageId, message: assistantMsg })

    for (let i = 0; i < reply.length; i++) {
      if (signal?.aborted) break
      await delay(30, signal)
      options.onEvent({ type: 'message_update', messageId, delta: reply[i] })
    }

    options.onEvent({ type: 'message_end', messageId, message: assistantMsg })
  }
}

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

function extractCity(text: string): string | null {
  const match = text.match(/(.+?)(?:的)?天气/)
  return match ? match[1].trim() : null
}

function extractExpression(text: string): string | null {
  const match = text.match(/(\d+[\s+\-*/().\d]*)/)
  return match ? match[1].replace(/\s/g, '') : null
}

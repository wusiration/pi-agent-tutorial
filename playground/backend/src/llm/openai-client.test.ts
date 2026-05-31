import { describe, it, expect, vi } from 'vitest'
import { openaiStream } from './openai-client.js'
import type { Message, AgentEvent } from '../../../shared/types.js'

describe('OpenAI Client', () => {
  it('should decode UTF-8 characters split across chunks', () => {
    const text = '北京天气'
    const encoder = new TextEncoder()
    const bytes = encoder.encode(text)

    // 故意在中文字符中间拆分字节
    const chunk1 = bytes.slice(0, 5) // 拆分第一个中文字符
    const chunk2 = bytes.slice(5)

    const decoder = new TextDecoder()
    let result = ''

    result += decoder.decode(chunk1, { stream: true })
    result += decoder.decode(chunk2, { stream: true })
    result += decoder.decode() // flush

    expect(result).toBe('北京天气')
  })

  it('should handle tool call arguments parse error as error result', async () => {
    // 模拟一个返回无效 JSON 的 SSE 流
    const invalidJson = '{invalid'
    const sseLines = [
      'data: {"id":"chat-1","object":"chat.completion.chunk","choices":[{"delta":{"role":"assistant"},"index":0}]}',
      'data: {"id":"chat-1","object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"id":"call-1","function":{"name":"weather","arguments":""}}]},"index":0}]}',
      `data: {"id":"chat-1","object":"chat.completion.chunk","choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"${invalidJson}"}}]},"index":0}]}`,
      'data: {"id":"chat-1","object":"chat.completion.chunk","choices":[{"finish_reason":"tool_calls","index":0}]}',
      'data: [DONE]',
    ]

    const encoder = new TextEncoder()
    const stream = new ReadableStream({
      start(controller) {
        for (const line of sseLines) {
          controller.enqueue(encoder.encode(line + '\n'))
        }
        controller.close()
      },
    })

    // Mock global fetch
    const originalFetch = globalThis.fetch
    globalThis.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: stream,
    } as Response)

    const events: AgentEvent[] = []
    const messages: Message[] = []

    await openaiStream(
      messages,
      [{
        name: 'weather',
        label: 'Weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: {} },
      }],
      {
        onEvent: (event) => events.push(event),
      }
    )

    globalThis.fetch = originalFetch

    // 验证 message_end 事件包含 isError 标记的 toolCall
    const messageEndEvents = events.filter((e) => e.type === 'message_end')
    expect(messageEndEvents.length).toBe(1)

    const msg = messageEndEvents[0].message
    expect(msg.role).toBe('assistant')
    const content = Array.isArray(msg.content) ? msg.content : []
    const toolCalls = content.filter((c: any) => c.type === 'toolCall')
    expect(toolCalls.length).toBe(1)
    const tc = toolCalls[0] as any
    expect(tc.isError).toBe(true)
    expect(tc.arguments.__parseError).toBe(true)
  })
})

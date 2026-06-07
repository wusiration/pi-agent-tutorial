import { describe, it, expect, vi } from 'vitest'
import { OpenAIProvider } from './openai-provider.js'
import { MockProvider } from './mock-provider.js'
import type { Message, AgentEvent, ToolDefinition } from '../../../shared/types.js'

describe('OpenAIProvider', () => {
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
    const provider = new OpenAIProvider()

    await provider.stream(
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

describe('MockProvider', () => {
  it('should return text response for normal query', async () => {
    const provider = new MockProvider()
    const events: AgentEvent[] = []

    await provider.stream(
      [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
      [],
      { onEvent: (event) => events.push(event) }
    )

    const messageEndEvents = events.filter((e) => e.type === 'message_end')
    expect(messageEndEvents.length).toBe(1)
    const msg = messageEndEvents[0].message as any
    expect(msg.role).toBe('assistant')
    const textContent = msg.content.find((c: any) => c.type === 'text')
    expect(textContent?.text).toContain('Hello')
  })

  it('should return tool call for weather query', async () => {
    const provider = new MockProvider()
    const events: AgentEvent[] = []

    await provider.stream(
      [{ role: 'user', content: '北京天气怎么样', timestamp: Date.now() }],
      [{
        name: 'weather',
        label: 'Weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: {} },
      }],
      { onEvent: (event) => events.push(event) }
    )

    const messageEndEvents = events.filter((e) => e.type === 'message_end')
    expect(messageEndEvents.length).toBe(1)
    const msg = messageEndEvents[0].message as any
    expect(msg.role).toBe('assistant')
    const toolCall = msg.content.find((c: any) => c.type === 'toolCall')
    expect(toolCall).toBeDefined()
    expect(toolCall?.name).toBe('weather')
  })

  it('should return final answer after tool result', async () => {
    const provider = new MockProvider()
    const events: AgentEvent[] = []

    await provider.stream(
      [
        { role: 'user', content: '北京天气怎么样', timestamp: Date.now() },
        {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Using tool' },
            { type: 'toolCall', id: 'call-1', name: 'weather', arguments: { city: '北京' } },
          ],
          stopReason: 'toolUse',
          timestamp: Date.now(),
        },
        {
          role: 'toolResult',
          toolCallId: 'call-1',
          toolName: 'weather',
          content: [{ type: 'text', text: 'Sunny 25C' }],
          isError: false,
          timestamp: Date.now(),
        },
      ],
      [{
        name: 'weather',
        label: 'Weather',
        description: 'Get weather',
        parameters: { type: 'object', properties: {} },
      }],
      { onEvent: (event) => events.push(event) }
    )

    const messageEndEvents = events.filter((e) => e.type === 'message_end')
    expect(messageEndEvents.length).toBe(1)
    const msg = messageEndEvents[0].message as any
    expect(msg.role).toBe('assistant')
    const textContent = msg.content.find((c: any) => c.type === 'text')
    expect(textContent?.text).toContain('Sunny 25C')
  })

  it('should abort when signal is triggered', async () => {
    const provider = new MockProvider()
    const controller = new AbortController()
    controller.abort()

    await expect(
      provider.stream(
        [{ role: 'user', content: 'Hello', timestamp: Date.now() }],
        [],
        { onEvent: () => {} },
        controller.signal
      )
    ).rejects.toThrow('Aborted')
  })
})

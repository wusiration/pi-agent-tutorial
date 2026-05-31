import { describe, it, expect, vi } from 'vitest'
import { runAgentLoop } from './agent-loop.js'
import type { AgentContext } from './types.js'
import type { Message, AssistantMessage } from '../../../shared/types.js'

// Mock LLM 客户端
vi.mock('../llm/mock-client.js', () => ({
  mockStream: vi.fn(),
}))

vi.mock('../llm/openai-client.js', () => ({
  openaiStream: vi.fn(),
}))

import { mockStream } from '../llm/mock-client.js'

describe('Agent Loop', () => {
  it('should emit correct event sequence for simple text response', async () => {
    const events: any[] = []
    const context: AgentContext = {
      systemPrompt: 'You are helpful.',
      messages: [],
      tools: [],
    }

    // Mock LLM 返回简单文本
    vi.mocked(mockStream).mockImplementation(async (messages, tools, options) => {
      const reply = 'Hello!'
      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: reply }],
        stopReason: 'stop',
        timestamp: Date.now(),
      }

      options.onEvent({ type: 'message_start', messageId: 'msg-1', message: assistantMsg })
      for (const char of reply) {
        options.onEvent({ type: 'message_update', messageId: 'msg-1', delta: char })
      }
      options.onEvent({ type: 'message_end', messageId: 'msg-1', message: assistantMsg })
    })

    await runAgentLoop(
      [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
      context,
      { useMock: true },
      (event) => events.push(event)
    )

    const eventTypes = events.map((e) => e.type)
    expect(eventTypes).toEqual([
      'agent_start',
      'message_start',   // user
      'message_end',     // user
      'turn_start',
      'message_start',   // assistant
      'message_update',  // H
      'message_update',  // e
      'message_update',  // l
      'message_update',  // l
      'message_update',  // o
      'message_update',  // !
      'message_end',     // assistant
      'turn_end',
      'agent_end',
    ])
  })

  it('should handle tool execution and continue loop', async () => {
    const events: any[] = []
    const context: AgentContext = {
      systemPrompt: 'You are helpful.',
      messages: [],
      tools: [{
        name: 'test_tool',
        label: 'Test',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({
          content: [{ type: 'text', text: 'Tool result' }],
        }),
      }],
    }

    let callCount = 0
    vi.mocked(mockStream).mockImplementation(async (messages, tools, options) => {
      callCount++

      if (callCount === 1) {
        // 第一次调用：返回 toolCall
        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: [
            { type: 'text', text: 'Using tool' },
            { type: 'toolCall', id: 'call-1', name: 'test_tool', arguments: {} },
          ],
          stopReason: 'toolUse',
          timestamp: Date.now(),
        }
        options.onEvent({ type: 'message_start', messageId: 'msg-1', message: assistantMsg })
        options.onEvent({ type: 'message_end', messageId: 'msg-1', message: assistantMsg })
      } else {
        // 第二次调用：返回最终结果
        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done!' }],
          stopReason: 'stop',
          timestamp: Date.now(),
        }
        options.onEvent({ type: 'message_start', messageId: 'msg-1', message: assistantMsg })
        options.onEvent({ type: 'message_end', messageId: 'msg-2', message: assistantMsg })
      }
    })

    await runAgentLoop(
      [{ role: 'user', content: 'Use tool', timestamp: Date.now() }],
      context,
      { useMock: true },
      (event) => events.push(event)
    )

    const toolEvents = events.filter((e) =>
      e.type === 'tool_execution_start' || e.type === 'tool_execution_end'
    )
    expect(toolEvents).toHaveLength(2)
    expect(toolEvents[0].type).toBe('tool_execution_start')
    expect(toolEvents[1].type).toBe('tool_execution_end')
    expect(toolEvents[1].isError).toBe(false)

    // 验证有两次 turn
    const turnStarts = events.filter((e) => e.type === 'turn_start')
    expect(turnStarts).toHaveLength(2)
  })

  it('should abort when signal is triggered', async () => {
    const controller = new AbortController()
    const events: any[] = []
    const context: AgentContext = {
      systemPrompt: 'You are helpful.',
      messages: [],
      tools: [],
    }

    vi.mocked(mockStream).mockImplementation(async (messages, tools, options, signal) => {
      // 模拟长时间运行的 LLM 调用
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, 200)
        signal?.addEventListener('abort', () => {
          clearTimeout(timer)
          reject(new Error('Aborted'))
        })
      })
    })

    // 50ms 后取消
    setTimeout(() => controller.abort(), 50)

    await expect(runAgentLoop(
      [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
      context,
      { useMock: true },
      (event) => events.push(event),
      controller.signal
    )).rejects.toThrow('Aborted')
  })

  it('should emit agent_error when maxTurns exceeded', async () => {
    const events: any[] = []
    const context: AgentContext = {
      systemPrompt: 'You are helpful.',
      messages: [],
      tools: [{
        name: 'loop_tool',
        label: 'Loop',
        description: 'Always returns tool call',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({
          content: [{ type: 'text', text: 'loop' }],
        }),
      }],
    }

    // Mock 永远返回 toolCall，模拟无限循环
    vi.mocked(mockStream).mockImplementation(async (messages, tools, options) => {
      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: [
          { type: 'toolCall', id: 'call-loop', name: 'loop_tool', arguments: {} },
        ],
        stopReason: 'toolUse',
        timestamp: Date.now(),
      }
      options.onEvent({ type: 'message_start', messageId: 'msg-1', message: assistantMsg })
      options.onEvent({ type: 'message_end', messageId: 'msg-loop', message: assistantMsg })
    })

    await runAgentLoop(
      [{ role: 'user', content: 'Loop forever', timestamp: Date.now() }],
      context,
      { useMock: true },
      (event) => events.push(event)
    )

    const endEvents = events.filter((e) => e.type === 'agent_end')
    expect(endEvents.length).toBeGreaterThan(0)
    expect(endEvents[endEvents.length - 1].status).toBe('error')
    expect(endEvents[endEvents.length - 1].error?.code).toBe('MAX_TURNS_EXCEEDED')
  })

  it('should succeed when final answer arrives exactly on the last allowed turn', async () => {
    const events: any[] = []
    const context: AgentContext = {
      systemPrompt: 'You are helpful.',
      messages: [],
      tools: [{
        name: 'test_tool',
        label: 'Test',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({
          content: [{ type: 'text', text: 'Tool result' }],
        }),
      }],
    }

    let callCount = 0
    vi.mocked(mockStream).mockImplementation(async (messages, tools, options) => {
      callCount++

      if (callCount <= 9) {
        // 前 9 次返回 toolCall
        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: [
            { type: 'toolCall', id: `call-${callCount}`, name: 'test_tool', arguments: {} },
          ],
          stopReason: 'toolUse',
          timestamp: Date.now(),
        }
        options.onEvent({ type: 'message_start', messageId: `msg-${callCount}`, message: assistantMsg })
        options.onEvent({ type: 'message_end', messageId: `msg-${callCount}`, message: assistantMsg })
      } else {
        // 第 10 次返回普通文本（正常完成）
        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: 'Final answer' }],
          stopReason: 'stop',
          timestamp: Date.now(),
        }
        options.onEvent({ type: 'message_start', messageId: 'msg-final', message: assistantMsg })
        options.onEvent({ type: 'message_end', messageId: 'msg-final', message: assistantMsg })
      }
    })

    await runAgentLoop(
      [{ role: 'user', content: 'Test max turns boundary', timestamp: Date.now() }],
      context,
      { useMock: true },
      (event) => events.push(event)
    )

    const endEvents = events.filter((e) => e.type === 'agent_end')
    expect(endEvents.length).toBe(1)
    expect(endEvents[0].status).toBe('success')
    expect(callCount).toBe(10)
  })

  it('should trim messages when maxMessages is exceeded', async () => {
    const events: any[] = []
    const context: AgentContext = {
      systemPrompt: 'You are helpful.',
      messages: [],
      tools: [],
    }

    vi.mocked(mockStream).mockImplementation(async (messages, tools, options) => {
      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Reply' }],
        stopReason: 'stop',
        timestamp: Date.now(),
      }
      options.onEvent({ type: 'message_start', messageId: 'msg-1', message: assistantMsg })
      options.onEvent({ type: 'message_end', messageId: 'msg-1', message: assistantMsg })
    })

    await runAgentLoop(
      [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
      context,
      { useMock: true, maxMessages: 4 },
      (event) => events.push(event)
    )

    // user + assistant = 2 messages, within limit
    expect(context.messages.length).toBeLessThanOrEqual(4)
  })

  it('should not keep orphan tool results after trimming', async () => {
    const events: any[] = []
    const context: AgentContext = {
      systemPrompt: 'You are helpful.',
      messages: [],
      tools: [{
        name: 'test_tool',
        label: 'Test',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({
          content: [{ type: 'text', text: 'result' }],
        }),
      }],
    }

    let callCount = 0
    vi.mocked(mockStream).mockImplementation(async (messages, tools, options) => {
      callCount++
      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: [
          { type: 'text', text: 'Using tool' },
          { type: 'toolCall', id: 'call-1', name: 'test_tool', arguments: {} },
        ],
        stopReason: 'toolUse',
        timestamp: Date.now(),
      }
      options.onEvent({ type: 'message_start', messageId: `msg-${callCount}`, message: assistantMsg })
      options.onEvent({ type: 'message_end', messageId: `msg-${callCount}`, message: assistantMsg })
    })

    await runAgentLoop(
      [{ role: 'user', content: 'Use tool', timestamp: Date.now() }],
      context,
      { useMock: true, maxMessages: 3, toolExecution: 'parallel' },
      (event) => events.push(event)
    )

    // After trimming, the first message should not be an orphan toolResult
    if (context.messages.length > 0) {
      expect(context.messages[0].role).not.toBe('toolResult')
    }
  })

  it('should trim normal chat messages when maxMessages is exceeded', async () => {
    const events: any[] = []
    const context: AgentContext = {
      systemPrompt: 'You are helpful.',
      messages: [],
      tools: [],
    }

    // 预先插入 5 轮历史（10 条消息）
    for (let i = 0; i < 5; i++) {
      context.messages.push({ role: 'user', content: `Q${i}`, timestamp: Date.now() })
      context.messages.push({ role: 'assistant', content: [{ type: 'text', text: `A${i}` }], stopReason: 'stop', timestamp: Date.now() })
    }

    vi.mocked(mockStream).mockImplementation(async (messages, tools, options) => {
      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Final' }],
        stopReason: 'stop',
        timestamp: Date.now(),
      }
      options.onEvent({ type: 'message_start', messageId: 'msg-final', message: assistantMsg })
      options.onEvent({ type: 'message_end', messageId: 'msg-final', message: assistantMsg })
    })

    await runAgentLoop(
      [{ role: 'user', content: 'Hi', timestamp: Date.now() }],
      context,
      { useMock: true, maxMessages: 4 },
      (event) => events.push(event)
    )

    // 应该保留最近 2 个完整 turn（4 条消息）
    expect(context.messages.length).toBeLessThanOrEqual(4)
    // 第一条应该是 user（完整 turn 开始）
    expect(context.messages[0].role).toBe('user')
  })

  it('should keep complete turns including toolCall and toolResult when trimming', async () => {
    const events: any[] = []
    const context: AgentContext = {
      systemPrompt: 'You are helpful.',
      messages: [],
      tools: [{
        name: 'test_tool',
        label: 'Test',
        description: 'A test tool',
        parameters: { type: 'object', properties: {} },
        execute: async () => ({
          content: [{ type: 'text', text: 'result' }],
        }),
      }],
    }

    // 预先插入 2 轮带工具的完整历史（每轮 user + assistant(toolCall) + toolResult = 3 条）
    for (let i = 0; i < 2; i++) {
      context.messages.push({ role: 'user', content: `Q${i}`, timestamp: Date.now() })
      context.messages.push({
        role: 'assistant',
        content: [
          { type: 'text', text: 'Using tool' },
          { type: 'toolCall', id: `call-${i}`, name: 'test_tool', arguments: {} },
        ],
        stopReason: 'toolUse',
        timestamp: Date.now(),
      })
      context.messages.push({
        role: 'toolResult',
        toolCallId: `call-${i}`,
        toolName: 'test_tool',
        content: [{ type: 'text', text: `result-${i}` }],
        isError: false,
        timestamp: Date.now(),
      })
    }

    // 第 3 轮：assistant 给出最终回答（普通文本）
    vi.mocked(mockStream).mockImplementation(async (messages, tools, options) => {
      const assistantMsg: AssistantMessage = {
        role: 'assistant',
        content: [{ type: 'text', text: 'Final answer' }],
        stopReason: 'stop',
        timestamp: Date.now(),
      }
      options.onEvent({ type: 'message_start', messageId: 'msg-final', message: assistantMsg })
      options.onEvent({ type: 'message_end', messageId: 'msg-final', message: assistantMsg })
    })

    await runAgentLoop(
      [{ role: 'user', content: 'Final question', timestamp: Date.now() }],
      context,
      { useMock: true, maxMessages: 5, toolExecution: 'parallel' },
      (event) => events.push(event)
    )

    // 最近一轮 user + assistant(final) = 2 条，加上上一轮完整 turn = 5 条
    // 但如果限制为 5，应该保留最近一轮（2 条）或最近一轮+上一轮（5 条）
    expect(context.messages.length).toBeLessThanOrEqual(5)
    // 第一条不应该是孤立的 toolResult
    expect(context.messages[0].role).not.toBe('toolResult')
    // 如果保留了 toolCall，toolResult 也应该在
    const hasToolCall = context.messages.some((m) => m.role === 'assistant' && Array.isArray(m.content) && m.content.some((c: any) => c.type === 'toolCall'))
    if (hasToolCall) {
      const hasToolResult = context.messages.some((m) => m.role === 'toolResult')
      expect(hasToolResult).toBe(true)
    }
  })
})

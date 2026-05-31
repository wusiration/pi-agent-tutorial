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

      options.onEvent({ type: 'message_start', message: assistantMsg })
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
        options.onEvent({ type: 'message_start', message: assistantMsg })
        options.onEvent({ type: 'message_end', messageId: 'msg-1', message: assistantMsg })
      } else {
        // 第二次调用：返回最终结果
        const assistantMsg: AssistantMessage = {
          role: 'assistant',
          content: [{ type: 'text', text: 'Done!' }],
          stopReason: 'stop',
          timestamp: Date.now(),
        }
        options.onEvent({ type: 'message_start', message: assistantMsg })
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
      options.onEvent({ type: 'message_start', message: assistantMsg })
      options.onEvent({ type: 'message_end', messageId: 'msg-loop', message: assistantMsg })
    })

    await runAgentLoop(
      [{ role: 'user', content: 'Loop forever', timestamp: Date.now() }],
      context,
      { useMock: true },
      (event) => events.push(event)
    )

    const errorEvents = events.filter((e) => e.type === 'agent_error')
    expect(errorEvents.length).toBeGreaterThan(0)
    expect(errorEvents[0].code).toBe('MAX_TURNS_EXCEEDED')
  })
})

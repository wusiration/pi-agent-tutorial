import type { Message, AgentEvent, ToolDefinition, AssistantMessage } from '../../../shared/types.js'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY || ''
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1'
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'

if (!OPENAI_API_KEY) {
  console.warn('[OpenAI Client] OPENAI_API_KEY is not set. OpenAI streaming will fail unless useMock is true.')
}

interface OpenAIStreamOptions {
  onEvent: (event: AgentEvent) => void
}

interface ToolCallBuffer {
  id: string
  name: string
  argumentsText: string
}

export async function openaiStream(
  messages: Message[],
  tools: ToolDefinition[],
  options: OpenAIStreamOptions,
  signal?: AbortSignal
): Promise<void> {
  const response = await fetch(`${OPENAI_BASE_URL}/chat/completions`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${OPENAI_API_KEY}`,
    },
    body: JSON.stringify({
      model: OPENAI_MODEL,
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
  let currentMessageId = ''
  let currentContent: any[] = []
  let isCollectingToolCall = false
  let pendingToolCalls: Map<number, ToolCallBuffer> = new Map()
  let parseErrorLogged = false
  const decoder = new TextDecoder()

  while (true) {
    const { done, value } = await reader.read()
    if (done) {
      buffer += decoder.decode()
      break
    }

    buffer += decoder.decode(value, { stream: true })
    const lines = buffer.split('\n')
    buffer = lines.pop() || ''

    for (const line of lines) {
      if (!line.startsWith('data: ')) continue
      const data = line.slice(6)
      if (data === '[DONE]') continue

      try {
        const chunk = JSON.parse(data)
        const choice = chunk.choices?.[0]
        if (!choice) continue

        const delta = choice.delta
        const finishReason = choice.finish_reason

        // 初始化消息（文本或 tool_calls 开始时）
        if (!currentMessageId && (delta?.content !== undefined || delta?.tool_calls !== undefined)) {
          currentMessageId = `msg-${Date.now()}`
          currentContent = []
          options.onEvent({
            type: 'message_start',
            messageId: currentMessageId,
            message: {
              role: 'assistant',
              content: [],
              stopReason: 'stop',
              timestamp: Date.now(),
            },
          })
        }

        // 处理文本增量
        if (delta?.content) {
          currentContent.push({ type: 'text', text: delta.content })
          options.onEvent({
            type: 'message_update',
            messageId: currentMessageId,
            delta: delta.content,
          })
        }

        // 处理 tool_calls（流式增量）—— 按 index 累积参数字符串
        if (delta?.tool_calls) {
          isCollectingToolCall = true

          for (const tc of delta.tool_calls) {
            const index = tc.index as number
            const existing = pendingToolCalls.get(index)
            if (existing) {
              // 追加增量
              if (tc.function?.name) existing.name += tc.function.name
              if (tc.function?.arguments) existing.argumentsText += tc.function.arguments
              if (tc.id) existing.id = tc.id
            } else {
              // 新的 tool call
              pendingToolCalls.set(index, {
                id: tc.id || '',
                name: tc.function?.name || '',
                argumentsText: tc.function?.arguments || '',
              })
            }
          }
        }

        // 完成时处理
        if (finishReason === 'tool_calls' || (finishReason === 'stop' && isCollectingToolCall)) {
          // 流结束，统一解析所有 tool call 参数
          const toolCallContent = Array.from(pendingToolCalls.entries()).map(([index, tc]) => {
            let parsedArgs: Record<string, any>
            try {
              parsedArgs = JSON.parse(tc.argumentsText || '{}')
            } catch (parseErr: any) {
              if (!parseErrorLogged) {
                console.error(`[OpenAI Stream] Tool call ${tc.id} (${tc.name}) arguments parse failed:`, {
                  index,
                  argumentsText: tc.argumentsText,
                  error: parseErr.message,
                })
                parseErrorLogged = true
              }
              // 解析失败时，生成一个错误结果，不进入工具执行
              return {
                type: 'toolCall' as const,
                id: tc.id || `call-${index}-${Date.now()}`,
                name: tc.name,
                arguments: { __parseError: true, __raw: tc.argumentsText, __error: parseErr.message },
                isError: true as const,
              }
            }

            return {
              type: 'toolCall' as const,
              id: tc.id || `call-${index}-${Date.now()}`,
              name: tc.name,
              arguments: parsedArgs,
            }
          })

          const assistantMsg: AssistantMessage = {
            role: 'assistant',
            content: [
              ...currentContent,
              ...toolCallContent,
            ],
            stopReason: 'toolUse',
            timestamp: Date.now(),
          }

          options.onEvent({
            type: 'message_end',
            messageId: currentMessageId || `msg-${Date.now()}`,
            message: assistantMsg,
          })

          // 重置状态
          currentMessageId = ''
          currentContent = []
          pendingToolCalls.clear()
          isCollectingToolCall = false
          parseErrorLogged = false
          return
        }

        if (finishReason === 'stop') {
          // 普通文本结束
          const text = currentContent
            .filter((c) => c.type === 'text')
            .map((c) => c.text)
            .join('')

          const assistantMsg: AssistantMessage = {
            role: 'assistant',
            content: [{ type: 'text', text }],
            stopReason: 'stop',
            timestamp: Date.now(),
          }

          options.onEvent({
            type: 'message_end',
            messageId: currentMessageId,
            message: assistantMsg,
          })

          currentMessageId = ''
          currentContent = []
          return
        }
      } catch (err: any) {
        // 记录解析错误，不静默吞掉
        console.error('[OpenAI Stream] Chunk parse error:', {
          line: line.slice(0, 200),
          error: err.message,
        })
        continue
      }
    }
  }

  // 流结束但没有收到 finish_reason（异常情况）
  if (currentMessageId) {
    const text = currentContent
      .filter((c) => c.type === 'text')
      .map((c) => c.text)
      .join('')

    options.onEvent({
      type: 'message_end',
      messageId: currentMessageId,
      message: {
        role: 'assistant',
        content: [{ type: 'text', text }],
        stopReason: 'stop',
        timestamp: Date.now(),
      },
    })
  }
}

function convertMessages(messages: Message[]): any[] {
  return messages.map((m) => {
    if (m.role === 'user') {
      return {
        role: 'user',
        content: typeof m.content === 'string'
          ? m.content
          : m.content.map((c) => (c.type === 'text' ? c.text : '')).join(''),
      }
    }
    if (m.role === 'assistant') {
      const textParts = m.content
        .filter((c) => c.type === 'text')
        .map((c) => c.text)
        .join('')

      const toolCalls = m.content
        .filter((c) => c.type === 'toolCall')
        .map((c) => ({
          id: c.id,
          type: 'function',
          function: {
            name: c.name,
            arguments: JSON.stringify(c.arguments),
          },
        }))

      const result: any = { role: 'assistant' }
      if (textParts) result.content = textParts
      if (toolCalls.length > 0) result.tool_calls = toolCalls
      return result
    }
    if (m.role === 'toolResult') {
      return {
        role: 'tool',
        tool_call_id: m.toolCallId,
        content: m.content.map((c) => (c.type === 'text' ? c.text : '')).join(''),
      }
    }
    return m
  })
}

function convertTool(tool: ToolDefinition): any {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  }
}

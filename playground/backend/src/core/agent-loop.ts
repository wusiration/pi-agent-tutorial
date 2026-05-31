import type { Message, ToolResultMessage, AgentEvent, AssistantMessage, ToolCallContent, Content } from '../../../shared/types.js'
import type { AgentContext, AgentTool, LoopConfig } from './types.js'
import { mockStream } from '../llm/mock-client.js'
import { openaiStream } from '../llm/openai-client.js'

function isToolCallContent(c: Content): c is ToolCallContent {
  return c.type === 'toolCall'
}

function isAssistantMessage(msg: Message): msg is AssistantMessage {
  return msg.role === 'assistant'
}

// 按完整 turn 裁剪消息，避免孤立 toolResult
// 一个完整 turn = assistant + 0..n toolResult（如果有 toolCall）
function trimMessagesByTurns(messages: Message[], maxMessages: number): Message[] {
  if (messages.length <= maxMessages) return messages

  // 从末尾开始，保留完整 turn
  // 策略：从后往前遍历，确保保留的消息序列以 user 或 assistant 开头，不以 toolResult 开头
  let start = messages.length - maxMessages
  while (start > 0 && messages[start]?.role === 'toolResult') {
    start--
  }
  // 再往前一步，确保我们从一个完整的 turn 开始（user 消息）
  // 但如果 start 已经是 0，就不需要再调整了
  // 实际上我们需要确保裁剪后的第一个消息不是 toolResult
  // 上面的循环已经确保了这一点

  return messages.slice(start)
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
    const userMessageId = `msg-${msg.timestamp}`
    emit({ type: 'message_start', messageId: userMessageId, message: msg })
    emit({ type: 'message_end', messageId: userMessageId, message: msg })
  }

  let turnCount = 0
  const maxTurns = 10
  let completed = false

  while (turnCount < maxTurns) {
    if (signal?.aborted) {
      emit({
        type: 'agent_end',
        status: 'aborted',
        messages: context.messages,
        error: { code: 'ABORTED', message: '请求已中止' },
      })
      return newMessages
    }
    turnCount++

    emit({ type: 'turn_start' })

    // 调用 LLM
    const result = await callLLM(context, config, emit, signal)
    if (!result.message) {
      completed = true
      break
    }

    const assistantMsg = result.message
    context.messages.push(assistantMsg)
    newMessages.push(assistantMsg)

    // 检查是否有工具调用（只对 assistant 消息）
    if (!isAssistantMessage(assistantMsg)) {
      emit({ type: 'turn_end', message: assistantMsg, toolResults: [] })
      completed = true
      break
    }

    const toolCalls = assistantMsg.content.filter(isToolCallContent)
    if (toolCalls.length === 0) {
      emit({ type: 'turn_end', message: assistantMsg, toolResults: [] })
      completed = true
      // 普通聊天也执行 maxMessages 裁剪
      if (config.maxMessages && context.messages.length > config.maxMessages) {
        context.messages = trimMessagesByTurns(context.messages, config.maxMessages)
      }
      break
    }

    // 执行工具（跳过参数解析失败的 tool call）
    const toolResults: ToolResultMessage[] = []
    const validToolCalls = toolCalls.filter((tc) => !tc.isError)
    const parseErrorCalls = toolCalls.filter((tc) => tc.isError)

    // 为解析失败的 tool call 直接生成错误结果
    for (const tc of parseErrorCalls) {
      const errorResult: ToolResultMessage = {
        role: 'toolResult',
        toolCallId: tc.id,
        toolName: tc.name,
        content: [{ type: 'text', text: `Tool call arguments parse error: ${tc.arguments.__error || 'unknown'}` }],
        isError: true,
        timestamp: Date.now(),
      }
      toolResults.push(errorResult)
      emit({
        type: 'tool_execution_end',
        toolCallId: tc.id,
        toolName: tc.name,
        result: { content: errorResult.content },
        isError: true,
      })
    }

    if (validToolCalls.length > 0) {
      if (config.toolExecution === 'parallel') {
        const promises = validToolCalls.map(async (tc: ToolCallContent) => {
          return executeTool(tc.id, tc.name, tc.arguments, context.tools, emit, signal)
        })
        const results = await Promise.all(promises)
        toolResults.push(...results)
      } else {
        for (const tc of validToolCalls) {
          const result = await executeTool(tc.id, tc.name, tc.arguments, context.tools, emit, signal)
          toolResults.push(result)
        }
      }
    }

    // 添加工具结果到上下文
    for (const tr of toolResults) {
      context.messages.push(tr)
      newMessages.push(tr)
    }

    emit({ type: 'turn_end', message: assistantMsg, toolResults })

    // 每轮结束后裁剪消息数量
    if (config.maxMessages && context.messages.length > config.maxMessages) {
      context.messages = trimMessagesByTurns(context.messages, config.maxMessages)
    }
  }

  // maxTurns 达到上限且未正常完成时的处理
  if (!completed && turnCount >= maxTurns) {
    console.error('[AgentLoop] MAX_TURNS_EXCEEDED', {
      turnCount,
      messageCount: context.messages.length,
      lastMessageRole: context.messages.at(-1)?.role,
    })
    emit({
      type: 'agent_end',
      status: 'error',
      messages: context.messages,
      error: { code: 'MAX_TURNS_EXCEEDED', message: '已达到最大工具调用轮数（10 轮），请调整问题或缩小任务范围。' },
    })
    return newMessages
  }

  emit({ type: 'agent_end', status: 'success', messages: context.messages })
  return newMessages
}

interface LLMResult {
  message: Message | null
}

async function callLLM(
  context: AgentContext,
  config: LoopConfig,
  emit: (event: AgentEvent) => void,
  signal?: AbortSignal
): Promise<LLMResult> {
  const result: LLMResult = { message: null }

  const onEvent = (event: AgentEvent) => {
    emit(event)
    if (event.type === 'message_end') {
      result.message = event.message
    }
  }

  try {
    if (config.useMock) {
      await mockStream(context.messages, context.tools, { onEvent }, signal)
    } else {
      await openaiStream(context.messages, context.tools, { onEvent }, signal)
    }
  } catch (error: any) {
    if (error.message === 'Aborted' || error.name === 'AbortError') {
      throw error // 重新抛出中止错误
    }
    console.error('[callLLM] LLM request failed:', error)
    throw error
  }

  return result
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
      content: [{ type: 'text', text: `工具未找到: ${toolName}` }],
      isError: true,
      timestamp: Date.now(),
    }
    emit({
      type: 'tool_execution_end',
      toolCallId,
      toolName,
      result: { content: errorResult.content },
      isError: true,
    })
    return errorResult
  }

  // 工具参数运行时校验
  const validationError = validateToolArgs(tool, args)
  if (validationError) {
    const errorResult: ToolResultMessage = {
      role: 'toolResult',
      toolCallId,
      toolName,
      content: [{ type: 'text', text: `工具参数错误: ${validationError}` }],
      isError: true,
      timestamp: Date.now(),
    }
    emit({
      type: 'tool_execution_end',
      toolCallId,
      toolName,
      result: { content: errorResult.content },
      isError: true,
    })
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

    emit({
      type: 'tool_execution_end',
      toolCallId,
      toolName,
      result,
      isError: false,
    })
    return toolResult
  } catch (error: any) {
    const toolResult: ToolResultMessage = {
      role: 'toolResult',
      toolCallId,
      toolName,
      content: [{ type: 'text', text: error.message || '未知错误' }],
      isError: true,
      timestamp: Date.now(),
    }

    emit({
      type: 'tool_execution_end',
      toolCallId,
      toolName,
      result: { content: toolResult.content },
      isError: true,
    })
    return toolResult
  }
}

import { Value } from '@sinclair/typebox/value'
import type { TSchema } from '@sinclair/typebox'

// 工具参数运行时校验（优先使用 TypeBox Value，回退到手写校验）
function validateToolArgs(tool: AgentTool, args: Record<string, any>): string | null {
  const schema = tool.parameters
  if (!schema || schema.type !== 'object') return null

  // 尝试使用 TypeBox Value 校验（如果 schema 是 TypeBox 对象）
  const kindSymbol = Symbol.for('TypeBox.Kind')
  if ((schema as any)[kindSymbol]) {
    const tschema = schema as unknown as TSchema
    if (!Value.Check(tschema, args)) {
      const errors = [...Value.Errors(tschema, args)]
      return errors.map((e) => `${e.path}: ${e.message}`).join('; ')
    }
    return null
  }

  // 回退：手写基础校验（兼容纯 JSON Schema）
  const required = schema.required || []
  const properties = schema.properties || {}

  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === '') {
      return `缺少必填参数: ${key}`
    }
  }

  for (const [key, value] of Object.entries(args)) {
    const propSchema = properties[key]
    if (!propSchema) continue

    if (propSchema.type === 'string' && typeof value !== 'string') {
      return `参数 ${key} 应为字符串，实际为 ${typeof value}`
    }
    if (propSchema.type === 'number' && typeof value !== 'number') {
      return `参数 ${key} 应为数字，实际为 ${typeof value}`
    }
    if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
      return `参数 ${key} 应为布尔值，实际为 ${typeof value}`
    }

    if (propSchema.type === 'string' && typeof value === 'string') {
      if (propSchema.minLength !== undefined && value.length < propSchema.minLength) {
        return `参数 ${key} 长度应 >= ${propSchema.minLength}`
      }
      if (propSchema.maxLength !== undefined && value.length > propSchema.maxLength) {
        return `参数 ${key} 长度应 <= ${propSchema.maxLength}`
      }
    }

    if (propSchema.type === 'number' && typeof value === 'number') {
      if (propSchema.minimum !== undefined && value < propSchema.minimum) {
        return `参数 ${key} 应 >= ${propSchema.minimum}`
      }
      if (propSchema.maximum !== undefined && value > propSchema.maximum) {
        return `参数 ${key} 应 <= ${propSchema.maximum}`
      }
    }
  }

  return null
}

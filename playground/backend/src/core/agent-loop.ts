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
    emit({ type: 'message_end', messageId: `msg-${msg.timestamp}`, message: msg })
  }

  let turnCount = 0
  const maxTurns = 10

  while (turnCount < maxTurns) {
    if (signal?.aborted) {
      emit({
        type: 'agent_error',
        code: 'ABORTED',
        message: '请求已中止',
      })
      break
    }
    turnCount++

    emit({ type: 'turn_start' })

    // 调用 LLM
    const result = await callLLM(context, config, emit, signal)
    if (!result.message) break

    const assistantMsg = result.message
    context.messages.push(assistantMsg)
    newMessages.push(assistantMsg)

    // 检查是否有工具调用（只对 assistant 消息）
    if (!isAssistantMessage(assistantMsg)) {
      emit({ type: 'turn_end', message: assistantMsg, toolResults: [] })
      break
    }

    const toolCalls = assistantMsg.content.filter(isToolCallContent)
    if (toolCalls.length === 0) {
      emit({ type: 'turn_end', message: assistantMsg, toolResults: [] })
      break
    }

    // 执行工具
    const toolResults: ToolResultMessage[] = []

    if (config.toolExecution === 'parallel') {
      const promises = toolCalls.map(async (tc: ToolCallContent) => {
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

  // maxTurns 达到上限时的明确处理
  if (turnCount >= maxTurns) {
    console.error('[AgentLoop] MAX_TURNS_EXCEEDED', {
      turnCount,
      messageCount: context.messages.length,
      lastMessageRole: context.messages.at(-1)?.role,
    })
    emit({
      type: 'agent_error',
      code: 'MAX_TURNS_EXCEEDED',
      message: '已达到最大工具调用轮数（10 轮），请调整问题或缩小任务范围。',
    })
  }

  emit({ type: 'agent_end', messages: context.messages })
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
    emit({
      type: 'agent_error',
      code: 'MODEL_ERROR',
      message: `LLM 请求失败: ${error.message}`,
    })
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

// 工具参数运行时校验
function validateToolArgs(tool: AgentTool, args: Record<string, any>): string | null {
  const schema = tool.parameters
  if (!schema || schema.type !== 'object') return null

  const required = schema.required || []
  const properties = schema.properties || {}

  // 检查必填字段
  for (const key of required) {
    if (args[key] === undefined || args[key] === null || args[key] === '') {
      return `缺少必填参数: ${key}`
    }
  }

  // 检查类型和约束
  for (const [key, value] of Object.entries(args)) {
    const propSchema = properties[key]
    if (!propSchema) continue

    // 类型检查
    if (propSchema.type === 'string' && typeof value !== 'string') {
      return `参数 ${key} 应为字符串，实际为 ${typeof value}`
    }
    if (propSchema.type === 'number' && typeof value !== 'number') {
      return `参数 ${key} 应为数字，实际为 ${typeof value}`
    }
    if (propSchema.type === 'boolean' && typeof value !== 'boolean') {
      return `参数 ${key} 应为布尔值，实际为 ${typeof value}`
    }

    // 字符串长度检查
    if (propSchema.type === 'string' && typeof value === 'string') {
      if (propSchema.minLength !== undefined && value.length < propSchema.minLength) {
        return `参数 ${key} 长度应 >= ${propSchema.minLength}`
      }
      if (propSchema.maxLength !== undefined && value.length > propSchema.maxLength) {
        return `参数 ${key} 长度应 <= ${propSchema.maxLength}`
      }
    }

    // 数字范围检查
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

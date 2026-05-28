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
    if (signal?.aborted) break
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

  if (config.useMock) {
    await mockStream(context.messages, context.tools, { onEvent }, signal)
  } else {
    await openaiStream(context.messages, context.tools, { onEvent }, signal)
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

import type {
  Message,
  ToolDefinition,
  ToolResult,
  AgentEvent,
} from '../../../shared/types.js'

export { Message, ToolDefinition, ToolResult, AgentEvent }

export interface AgentTool extends ToolDefinition {
  execute: (
    toolCallId: string,
    params: Record<string, any>,
    signal?: AbortSignal,
    onUpdate?: (partial: ToolResult) => void
  ) => Promise<ToolResult>
  executionMode?: 'sequential' | 'parallel'
}

export interface AgentContext {
  systemPrompt: string
  messages: Message[]
  tools: AgentTool[]
}

export interface AgentState {
  systemPrompt: string
  messages: Message[]
  tools: AgentTool[]
  isStreaming: boolean
  streamingMessageId?: string
}

export interface AgentOptions {
  initialState: Partial<AgentState>
  toolExecution?: 'sequential' | 'parallel'
}

export type AgentEventListener = (event: AgentEvent) => void | Promise<void>

export interface LoopConfig {
  useMock?: boolean
  toolExecution?: 'sequential' | 'parallel'
}

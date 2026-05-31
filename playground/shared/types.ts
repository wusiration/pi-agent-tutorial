// ============================================
// 前后端共享类型定义
// ============================================

// ---- 消息类型 ----

export interface TextContent {
  type: 'text'
  text: string
}

export interface ImageContent {
  type: 'image'
  data: string
  mimeType: string
}

export interface ToolCallContent {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, any>
  isError?: boolean
}

export type Content = TextContent | ImageContent | ToolCallContent

export interface UserMessage {
  role: 'user'
  content: string | (TextContent | ImageContent)[]
  timestamp: number
}

export interface AssistantMessage {
  role: 'assistant'
  content: Content[]
  stopReason: 'stop' | 'length' | 'toolUse' | 'error'
  timestamp: number
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: (TextContent | ImageContent)[]
  isError: boolean
  timestamp: number
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage

// ---- 工具定义 ----

export interface ToolDefinition {
  name: string
  label: string
  description: string
  parameters: Record<string, any> // JSON Schema
}

export interface ToolResult {
  content: (TextContent | ImageContent)[]
  details?: Record<string, any>
  terminate?: boolean
}

// ---- Agent 事件 ----

export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; status: 'success' | 'error' | 'aborted'; messages: Message[]; error?: { code: string; message: string } }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: Message; toolResults: ToolResultMessage[] }
  | { type: 'message_start'; messageId: string; message: Message }
  | { type: 'message_update'; messageId: string; delta: string }
  | { type: 'message_end'; messageId: string; message: Message }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool_execution_update'; toolCallId: string; partialResult: ToolResult }
  | { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: ToolResult; isError: boolean }

// ---- API 请求/响应 ----

export interface ChatRequest {
  message: string
  sessionId?: string
  useMock?: boolean
}

export interface CreateSessionResponse {
  sessionId: string
}

export interface GetToolsResponse {
  tools: ToolDefinition[]
}

export interface GetHistoryResponse {
  messages: Message[]
}

export interface ResetResponse {
  success: boolean
}

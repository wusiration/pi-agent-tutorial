import type { Message, AgentEvent, ToolDefinition } from '../../../shared/types.js'

export interface LLMProvider {
  stream(
    messages: Message[],
    tools: ToolDefinition[],
    options: { onEvent: (event: AgentEvent) => void },
    signal?: AbortSignal
  ): Promise<void>
}

import type { Message, AgentEvent } from '../../../shared/types.js'
import type { AgentContext, AgentState, AgentOptions, AgentEventListener } from './types.js'
import { runAgentLoop } from './agent-loop.js'

export class Agent {
  private context: AgentContext
  private listeners: AgentEventListener[] = []
  private _isStreaming = false
  private abortController: AbortController | null = null

  constructor(options: AgentOptions) {
    this.context = {
      systemPrompt: options.initialState.systemPrompt || 'You are a helpful assistant.',
      messages: options.initialState.messages || [],
      tools: options.initialState.tools || [],
    }
  }

  get state(): AgentState {
    return {
      systemPrompt: this.context.systemPrompt,
      messages: this.context.messages,
      tools: this.context.tools,
      isStreaming: this._isStreaming,
      streamingMessageId: undefined,
    }
  }

  subscribe(listener: AgentEventListener): () => void {
    this.listeners.push(listener)
    return () => {
      const idx = this.listeners.indexOf(listener)
      if (idx >= 0) this.listeners.splice(idx, 1)
    }
  }

  private emit(event: AgentEvent) {
    for (const listener of this.listeners) {
      try {
        listener(event)
      } catch (e) {
        console.error('Event listener error:', e)
      }
    }
  }

  async prompt(message: string | Message, options?: { useMock?: boolean }): Promise<void> {
    if (this._isStreaming) {
      throw new Error('Agent is already streaming')
    }

    this._isStreaming = true
    this.abortController = new AbortController()

    const userMsg: Message =
      typeof message === 'string'
        ? { role: 'user', content: message, timestamp: Date.now() }
        : message

    try {
      await runAgentLoop(
        [userMsg],
        this.context,
        { useMock: options?.useMock, toolExecution: 'parallel' },
        (event) => this.emit(event),
        this.abortController.signal
      )
    } finally {
      this._isStreaming = false
      this.abortController = null
    }
  }

  abort(): void {
    this.abortController?.abort()
  }

  reset() {
    this.context.messages = []
    this._isStreaming = false
    this.abortController = null
  }
}

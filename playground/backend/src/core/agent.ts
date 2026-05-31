import type { Message, AgentEvent } from '../../../shared/types.js'
import type { AgentContext, AgentState, AgentOptions, AgentEventListener } from './types.js'
import { runAgentLoop } from './agent-loop.js'

function mergeAbortSignals(internalSignal: AbortSignal, externalSignal?: AbortSignal): AbortSignal {
  if (!externalSignal) return internalSignal
  if (internalSignal.aborted || externalSignal.aborted) {
    const controller = new AbortController()
    controller.abort()
    return controller.signal
  }
  const controller = new AbortController()
  const abort = () => controller.abort()
  internalSignal.addEventListener('abort', abort, { once: true })
  externalSignal.addEventListener('abort', abort, { once: true })
  return controller.signal
}

export class Agent {
  private context: AgentContext
  private listeners: AgentEventListener[] = []
  private _isStreaming = false
  private abortController: AbortController | null = null
  private maxMessages: number | undefined

  constructor(options: AgentOptions) {
    this.context = {
      systemPrompt: options.initialState.systemPrompt || 'You are a helpful assistant.',
      messages: options.initialState.messages || [],
      tools: options.initialState.tools || [],
    }
    this.maxMessages = options.maxMessages
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

  async prompt(
    message: string | Message,
    options?: { useMock?: boolean; signal?: AbortSignal }
  ): Promise<void> {
    if (this._isStreaming) {
      throw new Error('Agent is already streaming')
    }

    this._isStreaming = true

    // Agent 始终持有内部 controller，外部 signal 只是额外中止来源
    const controller = new AbortController()
    this.abortController = controller
    const signal = mergeAbortSignals(controller.signal, options?.signal)

    const userMsg: Message =
      typeof message === 'string'
        ? { role: 'user', content: message, timestamp: Date.now() }
        : message

    try {
      await runAgentLoop(
        [userMsg],
        this.context,
        { useMock: options?.useMock, toolExecution: 'parallel', maxMessages: this.maxMessages },
        (event) => this.emit(event),
        signal
      )
    } finally {
      if (this.abortController === controller) {
        this.abortController = null
      }
      this._isStreaming = false
    }
  }

  abort(): void {
    this.abortController?.abort()
  }

  setAbortController(controller: AbortController | null): void {
    this.abortController = controller
  }

  reset() {
    this.abortController?.abort()
    this.context.messages = []
    this._isStreaming = false
    this.abortController = null
  }
}

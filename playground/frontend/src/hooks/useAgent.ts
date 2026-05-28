import { useState, useCallback, useRef } from 'react'
import type { AgentEvent, Message } from '../../../shared/types'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
  toolStatus?: 'running' | 'done' | 'error'
  isError?: boolean
  args?: Record<string, any>
}

export function useAgent() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>('default')
  const abortRef = useRef<AbortController | null>(null)
  const assistantMessageIds = useRef<Map<string, string>>(new Map())

  const createSession = useCallback(async () => {
    const res = await fetch('/api/sessions', { method: 'POST' })
    const data = await res.json()
    setSessionId(data.sessionId)
    setMessages([])
    assistantMessageIds.current.clear()
    return data.sessionId as string
  }, [])

  const loadHistory = useCallback(async (sid: string) => {
    const res = await fetch(`/api/history?sessionId=${sid}`)
    const data = await res.json()
    const history: ChatMessage[] = data.messages.map((m: any, idx: number) => ({
      id: `h-${idx}`,
      role: m.role === 'toolResult' ? 'tool' : m.role,
      content: typeof m.content === 'string'
        ? m.content
        : m.content?.map((c: any) => c.text).join('') || '',
      toolName: m.toolName,
      isError: m.isError,
    }))
    setMessages(history)
    setSessionId(sid)
  }, [])

  const sendMessage = useCallback(async (text: string, useMock?: boolean) => {
    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
    }
    setMessages((prev) => [...prev, userMsg])
    setIsLoading(true)

    abortRef.current = new AbortController()

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId, useMock }),
        signal: abortRef.current.signal,
      })

      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6)
          if (!data) continue

          try {
            const event: AgentEvent = JSON.parse(data)
            handleEvent(event)
          } catch {
            // ignore
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setMessages((prev) => [
          ...prev,
          { id: `err-${Date.now()}`, role: 'assistant', content: `Error: ${error.message}`, isError: true },
        ])
      }
    } finally {
      setIsLoading(false)
      abortRef.current = null
    }
  }, [sessionId])

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'message_start': {
        if (event.message.role === 'assistant') {
          const id = `a-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
          // 记录 messageId -> 内部 id 的映射
          const msgId = `msg-${event.message.timestamp}`
          assistantMessageIds.current.set(msgId, id)
          setMessages((prev) => [...prev, { id, role: 'assistant', content: '' }])
        }
        break
      }

      case 'message_update': {
        setMessages((prev) => {
          const internalId = assistantMessageIds.current.get(event.messageId)
          if (!internalId) return prev

          const idx = prev.findIndex((m) => m.id === internalId)
          if (idx >= 0 && prev[idx].role === 'assistant') {
            const updated = [...prev]
            updated[idx] = { ...updated[idx], content: updated[idx].content + event.delta }
            return updated
          }
          return prev
        })
        break
      }

      case 'message_end': {
        // 更新最终消息内容
        setMessages((prev) => {
          const internalId = assistantMessageIds.current.get(event.messageId)
          if (!internalId) return prev

          const idx = prev.findIndex((m) => m.id === internalId)
          if (idx >= 0) {
            const updated = [...prev]
            const text = event.message.content
              .filter((c) => c.type === 'text')
              .map((c) => c.text)
              .join('')
            updated[idx] = { ...updated[idx], content: text || updated[idx].content }
            return updated
          }
          return prev
        })
        break
      }

      case 'tool_execution_start': {
        setMessages((prev) => [
          ...prev,
          {
            id: `t-${event.toolCallId}`,
            role: 'tool',
            content: '',
            toolName: event.toolName,
            toolStatus: 'running',
            args: event.args,
          },
        ])
        break
      }

      case 'tool_execution_end': {
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === `t-${event.toolCallId}`)
          if (idx >= 0) {
            const updated = [...prev]
            updated[idx] = {
              ...updated[idx],
              content: event.result.content.map((c: any) => c.text).join(''),
              toolStatus: event.isError ? 'error' : 'done',
              isError: event.isError,
            }
            return updated
          }
          return prev
        })
        break
      }

      case 'agent_end': {
        setIsLoading(false)
        break
      }
    }
  }, [])

  const reset = useCallback(async () => {
    await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    setMessages([])
    assistantMessageIds.current.clear()
  }, [sessionId])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const exportSession = useCallback(async () => {
    const res = await fetch(`/api/export?sessionId=${sessionId}`)
    const data = await res.json()
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `session-${sessionId}.json`
    a.click()
    URL.revokeObjectURL(url)
  }, [sessionId])

  return {
    messages,
    isLoading,
    sessionId,
    createSession,
    loadHistory,
    sendMessage,
    reset,
    abort,
    exportSession,
  }
}

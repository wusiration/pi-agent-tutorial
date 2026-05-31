import { useState, useCallback, useRef } from 'react'
import type { AgentEvent } from '../../../shared/types'

async function ensureOk(response: Response): Promise<Response> {
  if (response.ok) return response
  const body = await response.json().catch(() => null)
  throw new Error(body?.error || body?.message || `HTTP ${response.status}`)
}

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
  const [error, setError] = useState<string | null>(null)
  const [sessionId, setSessionId] = useState<string>('')
  const abortRef = useRef<AbortController | null>(null)
  const assistantMessageIds = useRef<Map<string, string>>(new Map())

  const createSession = useCallback(async () => {
    const res = await fetch('/api/sessions', { method: 'POST' })
    await ensureOk(res)
    const data = await res.json()
    setSessionId(data.sessionId)
    setMessages([])
    setError(null)
    assistantMessageIds.current.clear()
    return data.sessionId as string
  }, [])

  const loadHistory = useCallback(async (sid: string) => {
    const res = await fetch(`/api/history?sessionId=${sid}`)
    await ensureOk(res)
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
    setError(null)
  }, [])

  const sendMessage = useCallback(async (text: string, useMock?: boolean) => {
    // 如果没有 sessionId，先创建一个
    let currentSessionId = sessionId
    if (!currentSessionId) {
      const res = await fetch('/api/sessions', { method: 'POST' })
      await ensureOk(res)
      const data = await res.json()
      currentSessionId = data.sessionId
      setSessionId(currentSessionId)
    }

    const userMsg: ChatMessage = {
      id: `u-${Date.now()}`,
      role: 'user',
      content: text,
    }
    setMessages((prev) => [...prev, userMsg])
    setIsLoading(true)
    setError(null)

    abortRef.current = new AbortController()

    try {
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: text, sessionId: currentSessionId, useMock }),
        signal: abortRef.current.signal,
      })

      await ensureOk(response)

      if (!response.body) throw new Error('No response body')

      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          // flush decoder
          const remaining = decoder.decode()
          if (remaining) {
            buffer += remaining
          }
          // 处理最后一行
          if (buffer) {
            const lines = buffer.split('\n')
            for (const line of lines) {
              if (!line.startsWith('data: ')) continue
              const data = line.slice(6)
              if (!data) continue
              try {
                const event: AgentEvent = JSON.parse(data)
                handleEvent(event)
              } catch {
                // ignore parse error for individual events
              }
            }
          }
          break
        }

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
            // ignore parse error for individual events
          }
        }
      }
    } catch (error: any) {
      if (error.name !== 'AbortError') {
        setError(error.message || '请求失败')
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
          // 直接使用后端提供的 messageId
          assistantMessageIds.current.set(event.messageId, id)
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
            const text = Array.isArray(event.message.content)
              ? event.message.content
                .filter((c: any) => c.type === 'text')
                .map((c: any) => c.text)
                .join('')
              : event.message.content
            updated[idx] = { ...updated[idx], content: text || updated[idx].content }
            return updated
          }
          return prev
        })
        // 清理映射，避免 Map 持续增长
        assistantMessageIds.current.delete(event.messageId)
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
        if (event.status === 'error' && event.error) {
          setError(event.error.message)
        }
        setIsLoading(false)
        break
      }
    }
  }, [])

  const reset = useCallback(async () => {
    if (!sessionId) return
    const res = await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    await ensureOk(res)
    setMessages([])
    setError(null)
    assistantMessageIds.current.clear()
  }, [sessionId])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  const exportSession = useCallback(async () => {
    if (!sessionId) return
    const res = await fetch(`/api/export?sessionId=${sessionId}`)
    await ensureOk(res)
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
    error,
    sessionId,
    createSession,
    loadHistory,
    sendMessage,
    reset,
    abort,
    exportSession,
  }
}

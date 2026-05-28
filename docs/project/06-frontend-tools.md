# 06 前端：工具执行可视化

> 这一章优化工具执行的 UI 表现，并添加会话管理功能（新建会话、切换会话、导出历史）。

## 优化工具卡片

当前的 `MessageBubble` 对工具消息的展示比较简陋。我们单独做一个 `ToolCard` 组件：

```tsx
// frontend/src/components/ToolCard.tsx
import { useEffect, useState } from 'react'

interface Props {
  toolName: string
  args?: Record<string, any>
  status: 'running' | 'done' | 'error'
  result?: string
  duration?: number
}

export function ToolCard({ toolName, args, status, result, duration }: Props) {
  const [elapsed, setElapsed] = useState(0)

  useEffect(() => {
    if (status !== 'running') return
    const interval = setInterval(() => setElapsed((e) => e + 1), 1000)
    return () => clearInterval(interval)
  }, [status])

  const statusConfig = {
    running: { icon: '⏳', color: 'border-blue-300 bg-blue-50', text: '执行中' },
    done: { icon: '✅', color: 'border-green-300 bg-green-50', text: '已完成' },
    error: { icon: '❌', color: 'border-red-300 bg-red-50', text: '失败' },
  }

  const config = statusConfig[status]

  return (
    <div className={`rounded-lg border ${config.color} p-3 my-2 max-w-md`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span>{config.icon}</span>
          <span className="font-medium text-sm">{toolName}</span>
        </div>
        <span className="text-xs text-gray-500">{config.text}</span>
      </div>

      {args && Object.keys(args).length > 0 && (
        <div className="text-xs text-gray-600 mb-2 bg-white/50 rounded px-2 py-1">
          <code>{JSON.stringify(args)}</code>
        </div>
      )}

      {status === 'running' && (
        <div className="text-xs text-blue-600">
          已执行 {elapsed} 秒...
        </div>
      )}

      {result && (
        <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap border-t border-gray-200 pt-2">
          {result}
        </div>
      )}

      {duration && status !== 'running' && (
        <div className="text-xs text-gray-400 mt-1">
          耗时: {(duration / 1000).toFixed(2)}s
        </div>
      )}
    </div>
  )
}
```

## 更新 MessageBubble 支持 ToolCard

```tsx
// frontend/src/components/MessageBubble.tsx
import { ToolCard } from './ToolCard'
import type { ChatMessage } from '../hooks/useAgent'

interface Props {
  message: ChatMessage
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'

  if (message.role === 'tool') {
    return (
      <div className="flex justify-start mb-2">
        <ToolCard
          toolName={message.toolName || 'unknown'}
          status={message.toolStatus || 'done'}
          result={message.content}
        />
      </div>
    )
  }

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
          isUser
            ? 'bg-blue-600 text-white'
            : message.isError
            ? 'bg-red-100 text-red-800'
            : 'bg-white text-gray-800 shadow'
        }`}
      >
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  )
}
```

## 会话管理

### 更新 useAgent hook

```ts
// frontend/src/hooks/useAgent.ts（新增会话管理）
import { useState, useCallback } from 'react'
import type { AgentEvent } from '../types/events'

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
  toolStatus?: 'running' | 'done' | 'error'
  isError?: boolean
}

export function useAgent() {
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [sessionId, setSessionId] = useState<string>('default')
  const abortRef = useRef<AbortController | null>(null)

  const createSession = useCallback(async () => {
    const res = await fetch('/api/sessions', { method: 'POST' })
    const data = await res.json()
    setSessionId(data.sessionId)
    setMessages([])
    return data.sessionId as string
  }, [])

  const loadHistory = useCallback(async (sid: string) => {
    const res = await fetch(`/api/history?sessionId=${sid}`)
    const data = await res.json()
    // 转换历史消息为 ChatMessage
    const history: ChatMessage[] = data.messages.map((m: any, idx: number) => ({
      id: `h-${idx}`,
      role: m.role === 'toolResult' ? 'tool' : m.role,
      content: typeof m.content === 'string' ? m.content : m.content?.map((c: any) => c.text).join('') || '',
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
          setMessages((prev) => [...prev, { id, role: 'assistant', content: '' }])
        }
        break
      }
      case 'message_update': {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last?.role === 'assistant') {
            const updated = [...prev]
            updated[updated.length - 1] = { ...last, content: last.content + event.delta }
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
  }, [sessionId])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return {
    messages,
    isLoading,
    sessionId,
    createSession,
    loadHistory,
    sendMessage,
    reset,
    abort,
  }
}
```

### 更新 Chat 组件

```tsx
// frontend/src/components/Chat.tsx
import { useState, useRef, useEffect } from 'react'
import { useAgent } from '../hooks/useAgent'
import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'

export function Chat() {
  const [input, setInput] = useState('')
  const [useMock, setUseMock] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { messages, isLoading, sessionId, createSession, sendMessage, reset } = useAgent()

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    sendMessage(input.trim(), useMock)
    setInput('')
  }

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-3">
          <h1 className="text-lg font-semibold">Pi Agent 教学版</h1>
          <span className="text-xs text-gray-400 font-mono">{sessionId.slice(0, 12)}...</span>
        </div>
        <div className="flex items-center gap-3">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={useMock}
              onChange={(e) => setUseMock(e.target.checked)}
              className="rounded"
            />
            Mock 模式
          </label>
          <button
            onClick={createSession}
            className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded"
          >
            新会话
          </button>
          <button
            onClick={reset}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            重置
          </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-2">
        {messages.length === 0 && (
          <div className="text-center text-gray-400 mt-20">
            <p className="text-4xl mb-4">🤖</p>
            <p>发送消息开始对话</p>
            <p className="text-sm mt-2">试试："北京天气怎么样？" 或 "计算 123 * 456"</p>
          </div>
        )}
        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isLoading && <TypingIndicator />}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="bg-white border-t p-4">
        <div className="flex gap-2">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder="输入消息..."
            className="flex-1 rounded-lg border border-gray-300 px-4 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
            disabled={isLoading}
          />
          <button
            type="submit"
            disabled={isLoading || !input.trim()}
            className="bg-blue-600 text-white px-6 py-2 rounded-lg font-medium disabled:opacity-50 hover:bg-blue-700"
          >
            发送
          </button>
        </div>
      </form>
    </div>
  )
}
```

## 导出会话历史

在 backend 添加导出端点：

```ts
// backend/src/api/routes.ts（添加到 registerRoutes）
app.get('/api/export', async (request, reply) => {
  const { sessionId } = request.query as { sessionId?: string }
  const agent = sessions.get(sessionId || 'default')
  if (!agent) {
    reply.status(404)
    return { error: 'Session not found' }
  }

  reply.header('Content-Type', 'application/json')
  reply.header('Content-Disposition', `attachment; filename="session-${sessionId}.json"`)
  return { messages: agent.state.messages, exportedAt: new Date().toISOString() }
})
```

前端添加导出按钮：

```tsx
const exportSession = async () => {
  const res = await fetch(`/api/export?sessionId=${sessionId}`)
  const data = await res.json()
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `session-${sessionId}.json`
  a.click()
  URL.revokeObjectURL(url)
}
```

## 本章小结

- `ToolCard` 组件让工具执行状态一目了然。
- 会话管理支持新建、重置、导出，模拟了 Pi 的会话概念。
- 前后端通过 `sessionId` 关联，内存存储适合教学演示。

## 运行验证

```bash
# 后端
cd backend
npm run dev

# 前端
cd frontend
npm run dev
```

测试 checklist：
- [ ] 发送消息，AI 逐字回复
- [ ] 工具执行时显示 ToolCard，有动画和计时
- [ ] 工具完成后显示结果
- [ ] 点击"新会话"创建独立对话
- [ ] Mock 模式开关有效
- [ ] 导出 JSON 文件内容正确

## 下一步

最后一章：联调、运行指南和扩展方向。

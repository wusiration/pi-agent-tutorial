# 05 前端：React 聊天界面

> 后端已经能流式输出事件，现在需要一个好的 UI 来展示。我们用 React + Tailwind 实现一个简洁的聊天界面。

## 文件 1：hooks/useEventSource.ts

封装 SSE 连接：

```ts
// frontend/src/hooks/useEventSource.ts
import { useEffect, useRef, useCallback } from 'react'

export function useEventSource() {
  const esRef = useRef<EventSource | null>(null)

  const connect = useCallback((url: string, onMessage: (data: any) => void, onError?: () => void) => {
    const es = new EventSource(url, { withCredentials: false })
    esRef.current = es

    es.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onMessage(data)
      } catch {
        console.error('Failed to parse SSE data:', event.data)
      }
    }

    es.onerror = () => {
      onError?.()
      es.close()
    }

    return () => {
      es.close()
      esRef.current = null
    }
  }, [])

  const disconnect = useCallback(() => {
    esRef.current?.close()
    esRef.current = null
  }, [])

  return { connect, disconnect }
}
```

> 注意：我们用 POST 请求发送消息，但 SSE 不支持 POST。解决方案是：先用 `fetch` POST 建立连接，服务器返回 SSE 流。或者改用 `fetch` + `ReadableStream` 手动解析 SSE。

实际上，由于 SSE 的 `EventSource` 只支持 GET，而我们的 `/api/chat` 是 POST，所以需要改用 `fetch` + `ReadableStream`：

```ts
// frontend/src/hooks/useAgent.ts
import { useState, useCallback, useRef } from 'react'
import type { AgentEvent, Message } from '../types/events'

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
  const [tools, setTools] = useState<Map<string, { name: string; status: string }>>(new Map())
  const abortRef = useRef<AbortController | null>(null)

  const sendMessage = useCallback(async (text: string, sessionId?: string, useMock?: boolean) => {
    // 添加用户消息
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

      // 用于累积当前 assistant 消息的临时状态
      let currentAssistantId: string | null = null

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
  }, [])

  const handleEvent = useCallback((event: AgentEvent) => {
    switch (event.type) {
      case 'message_start': {
        if (event.message.role === 'assistant') {
          const id = `a-${Date.now()}-${Math.random().toString(36).slice(2, 5)}`
          // 保存当前 assistant id 到闭包外变量不太方便，这里简化处理
          setMessages((prev) => [
            ...prev,
            { id, role: 'assistant', content: '' },
          ])
        }
        break
      }

      case 'message_update': {
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.role === 'assistant') {
            const updated = [...prev]
            updated[updated.length - 1] = { ...last, content: last.content + event.delta }
            return updated
          }
          return prev
        })
        break
      }

      case 'tool_execution_start': {
        setTools((prev) => new Map(prev).set(event.toolCallId, { name: event.toolName, status: 'running' }))
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
        setTools((prev) => new Map(prev).set(event.toolCallId, { name: event.toolName, status: event.isError ? 'error' : 'done' }))
        setMessages((prev) => {
          const idx = prev.findIndex((m) => m.id === `t-${event.toolCallId}`)
          if (idx >= 0) {
            const updated = [...prev]
            updated[idx] = {
              ...updated[idx],
              content: event.result.content.map((c) => c.text).join(''),
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

  const reset = useCallback(async (sessionId?: string) => {
    await fetch('/api/reset', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId }),
    })
    setMessages([])
    setTools(new Map())
  }, [])

  const abort = useCallback(() => {
    abortRef.current?.abort()
  }, [])

  return { messages, isLoading, tools, sendMessage, reset, abort }
}
```

## 文件 2：components/MessageBubble.tsx

```tsx
// frontend/src/components/MessageBubble.tsx
import type { ChatMessage } from '../hooks/useAgent'

interface Props {
  message: ChatMessage
}

export function MessageBubble({ message }: Props) {
  const isUser = message.role === 'user'
  const isTool = message.role === 'tool'

  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'} mb-4`}>
      <div
        className={`max-w-[80%] rounded-2xl px-4 py-2 ${
          isUser
            ? 'bg-blue-600 text-white'
            : isTool
            ? 'bg-gray-200 text-gray-800'
            : message.isError
            ? 'bg-red-100 text-red-800'
            : 'bg-white text-gray-800 shadow'
        }`}
      >
        {isTool && (
          <div className="flex items-center gap-2 text-sm text-gray-500 mb-1">
            <span>🔧 {message.toolName}</span>
            {message.toolStatus === 'running' && <span className="animate-pulse">...</span>}
            {message.toolStatus === 'done' && <span>✅</span>}
            {message.toolStatus === 'error' && <span>❌</span>}
          </div>
        )}
        <div className="whitespace-pre-wrap">{message.content}</div>
      </div>
    </div>
  )
}
```

## 文件 3：components/TypingIndicator.tsx

```tsx
// frontend/src/components/TypingIndicator.tsx
export function TypingIndicator() {
  return (
    <div className="flex justify-start mb-4">
      <div className="bg-white rounded-2xl px-4 py-3 shadow">
        <div className="flex gap-1">
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
          <span className="w-2 h-2 bg-gray-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
        </div>
      </div>
    </div>
  )
}
```

## 文件 4：components/Chat.tsx

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
  const { messages, isLoading, sendMessage, reset } = useAgent()

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    sendMessage(input.trim(), undefined, useMock)
    setInput('')
  }

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto bg-gray-50">
      {/* Header */}
      <div className="bg-white border-b px-4 py-3 flex items-center justify-between">
        <h1 className="text-lg font-semibold">Pi Agent 教学版</h1>
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
            onClick={() => reset()}
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

## 文件 5：App.tsx

```tsx
// frontend/src/App.tsx
import { Chat } from './components/Chat'

function App() {
  return <Chat />
}

export default App
```

## 文件 6：types/events.ts

```ts
// frontend/src/types/events.ts
export type { AgentEvent, Message, ToolResultMessage } from '../../../shared/types'
```

## 运行效果

```bash
# 后端
cd backend
npm run dev

# 前端（新终端）
cd frontend
npm run dev
```

打开 http://localhost:5173，你应该能看到：

1. 一个干净的聊天界面
2. 输入消息，点击发送
3. AI 回复逐字出现（Mock 模式下是固定延迟）
4. 工具执行时显示 🔧 图标和状态
5. Mock 模式开关可以切换

## 本章小结

- 前端用 `fetch` + `ReadableStream` 消费 SSE，因为 `EventSource` 不支持 POST。
- `useAgent` hook 封装了消息状态、工具状态、发送和重置逻辑。
- `MessageBubble` 根据角色和状态显示不同样式。
- 自动滚动到底部，保证用户始终看到最新消息。

## 常见错误

❌ **SSE 解析漏掉最后一个事件**
> `buffer.split('\n')` 后要用 `lines.pop()` 保留未完整的一行，否则可能截断事件。

❌ **React 状态更新闭包问题**
> 在 `while (true)` 循环里直接 `setMessages` 是安全的，因为 React 的 setter 支持函数形式。但如果用 `useRef` 缓存状态再更新，容易出闭包问题。

❌ **没有处理 AbortError**
> 用户取消请求时，`fetch` 会抛 `AbortError`，需要单独判断避免显示错误提示。

## 下一步

下一章优化工具执行的可视化效果，并添加会话管理功能。

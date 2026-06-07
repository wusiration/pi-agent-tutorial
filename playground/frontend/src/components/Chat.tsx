import { useState, useRef, useEffect } from 'react'
import { useAgent } from '../hooks/useAgent'
import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'

export function Chat() {
  const [input, setInput] = useState('')
  const [useMock, setUseMock] = useState(true)
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { messages, isLoading, error, sessionId, turnCount, createSession, sendMessage, reset, exportSession, abort } = useAgent()

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages, isLoading])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!input.trim() || isLoading) return
    const text = input.trim()
    try {
      await sendMessage(text, useMock)
      setInput('')
    } catch {
      // 错误已在 hook 中设置，保留 input 以便重试
    }
  }

  const [dismissedError, setDismissedError] = useState<string | null>(null)
  useEffect(() => {
    if (error && error !== dismissedError) {
      setDismissedError(null)
    }
  }, [error])

  const activeError = error && error !== dismissedError ? error : null

  return (
    <div className="flex h-screen bg-gray-50">
      {/* Sidebar */}
      <aside
        className={`shrink-0 bg-white border-r transition-all duration-300 overflow-hidden ${
          sidebarOpen ? 'w-64' : 'w-0 md:w-56'
        }`}
      >
        <div className="w-64 md:w-56 h-full flex flex-col p-4">
          <h2 className="text-sm font-semibold text-gray-700 mb-4">会话信息</h2>

          <div className="space-y-3 text-sm">
            <div className="flex justify-between">
              <span className="text-gray-500">会话 ID</span>
              <span className="font-mono text-gray-700 truncate max-w-[120px]">
                {sessionId ? `${sessionId.slice(0, 10)}...` : '—'}
              </span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">消息数</span>
              <span className="text-gray-700">{messages.length}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-gray-500">轮次</span>
              <span className="text-gray-700">{turnCount}</span>
            </div>
          </div>

          <div className="mt-auto space-y-2">
            <button
              onClick={exportSession}
              disabled={!sessionId}
              className="w-full text-sm bg-gray-100 hover:bg-gray-200 disabled:opacity-50 px-3 py-2 rounded"
            >
              导出会话
            </button>
            <button
              onClick={createSession}
              className="w-full text-sm bg-blue-600 text-white hover:bg-blue-700 px-3 py-2 rounded"
            >
              新会话
            </button>
          </div>
        </div>
      </aside>

      {/* Main Chat */}
      <div className="flex-1 flex flex-col min-w-0">
        {/* Header */}
        <div className="bg-white border-b px-3 py-3 flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 min-w-0">
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="md:hidden p-1 rounded hover:bg-gray-100 text-gray-600"
              aria-label="切换侧边栏"
            >
              ☰
            </button>
            <h1 className="text-base md:text-lg font-semibold truncate">Pi Agent 教学版</h1>
          </div>

          <div className="flex items-center gap-2 shrink-0">
            {/* Provider Toggle */}
            <div className="flex items-center bg-gray-100 rounded-lg p-0.5">
              <button
                onClick={() => setUseMock(true)}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${
                  useMock ? 'bg-white shadow text-gray-800' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                Mock
              </button>
              <button
                onClick={() => setUseMock(false)}
                className={`text-xs px-2 py-1 rounded-md transition-colors ${
                  !useMock ? 'bg-white shadow text-blue-700' : 'text-gray-500 hover:text-gray-700'
                }`}
              >
                OpenAI
              </button>
            </div>

            <span
              className={`hidden sm:inline-block w-2 h-2 rounded-full ${
                useMock ? 'bg-gray-400' : 'bg-green-500'
              }`}
              title={useMock ? 'Mock 模式' : 'OpenAI 模式'}
            />

            <div className="hidden md:flex items-center gap-2">
              <button
                onClick={createSession}
                className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded"
              >
                新会话
              </button>
              <button
                onClick={exportSession}
                disabled={!sessionId}
                className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded disabled:opacity-50"
              >
                导出
              </button>
              <button
                onClick={reset}
                disabled={!sessionId}
                className="text-sm text-gray-500 hover:text-gray-700 disabled:opacity-50"
              >
                重置
              </button>
              {isLoading && (
                <button onClick={abort} className="text-sm text-red-500 hover:text-red-700">
                  中止
                </button>
              )}
            </div>
          </div>
        </div>

        {/* Error Banner */}
        {activeError && (
          <div className="bg-red-50 border-b border-red-200 px-4 py-2 text-sm text-red-700 flex items-start justify-between gap-3">
            <span className="break-words">⚠️ {activeError}</span>
            <button
              onClick={() => setDismissedError(activeError)}
              className="text-red-400 hover:text-red-600 shrink-0"
              aria-label="关闭"
            >
              ✕
            </button>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-3 md:p-4 space-y-2">
          {messages.length === 0 && (
            <div className="text-center text-gray-400 mt-20 px-4">
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
        <form onSubmit={handleSubmit} className="bg-white border-t p-3 md:p-4">
          <div className="flex gap-2 max-w-3xl mx-auto">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="输入消息..."
              className="flex-1 min-w-0 rounded-lg border border-gray-300 px-3 py-2 text-sm md:text-base focus:outline-none focus:ring-2 focus:ring-blue-500"
              disabled={isLoading}
            />
            <button
              type="submit"
              disabled={isLoading || !input.trim()}
              className="shrink-0 bg-blue-600 text-white px-4 md:px-6 py-2 rounded-lg font-medium text-sm md:text-base disabled:opacity-50 hover:bg-blue-700"
            >
              发送
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

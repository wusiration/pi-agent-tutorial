import { useState, useRef, useEffect } from 'react'
import { useAgent } from '../hooks/useAgent'
import { MessageBubble } from './MessageBubble'
import { TypingIndicator } from './TypingIndicator'

export function Chat() {
  const [input, setInput] = useState('')
  const [useMock, setUseMock] = useState(true)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const { messages, isLoading, sessionId, createSession, sendMessage, reset, exportSession } = useAgent()

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
            onClick={exportSession}
            className="text-sm bg-gray-100 hover:bg-gray-200 px-3 py-1 rounded"
          >
            导出
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

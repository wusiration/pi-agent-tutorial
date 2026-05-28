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
          args={message.args}
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

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
    <div className={`rounded-lg border ${config.color} p-3 my-2 max-w-full md:max-w-md`}>
      <div className="flex items-center justify-between mb-2 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <span className="shrink-0">{config.icon}</span>
          <span className="font-medium text-sm truncate">{toolName}</span>
        </div>
        <span className="text-xs text-gray-500 shrink-0">{config.text}</span>
      </div>

      {args && Object.keys(args).length > 0 && (
        <div className="text-xs text-gray-600 mb-2 bg-white/50 rounded px-2 py-1 overflow-x-auto">
          <code className="break-all">{JSON.stringify(args)}</code>
        </div>
      )}

      {status === 'running' && (
        <div className="text-xs text-blue-600">
          已执行 {elapsed} 秒...
        </div>
      )}

      {result && (
        <div className="text-sm text-gray-700 mt-2 whitespace-pre-wrap break-words border-t border-gray-200 pt-2">
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

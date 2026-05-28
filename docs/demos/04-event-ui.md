# Demo 4：事件订阅与 UI

> 这个 Demo 用纯 Node.js 实现一个“终端聊天界面”，展示如何用事件系统驱动 UI 更新。这是前端 React 实现的基础。

## 目标

用 `Agent` 类 + `readline` 实现一个交互式终端聊天程序，支持：
- 实时显示 AI 打字效果
- 显示工具执行状态
- 显示错误提示
- 支持多轮对话

## 代码

```ts
// demos/04-event-ui/index.ts
import { Agent } from '@earendil-works/pi-agent-core'
import { getModel } from '@earendil-works/pi-ai'
import { Type } from '@sinclair/typebox'
import * as readline from 'readline'
import type { AgentTool, AgentEvent } from '@earendil-works/pi-agent-core'

const weatherTool: AgentTool = {
  name: 'weather',
  label: '天气',
  description: '查询天气',
  parameters: Type.Object({ city: Type.String() }),
  execute: async (id, params) => ({
    content: [{ type: 'text', text: `${params.city}: 18°C, rainy` }],
    details: {},
  }),
}

const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a helpful assistant.',
    model: getModel('openai', 'gpt-4o-mini'),
    tools: [weatherTool],
    messages: [],
  },
  convertToLlm: (msgs) => msgs.filter((m) => ['user', 'assistant', 'toolResult'].includes(m.role)),
})

// UI 状态
let currentLine = ''
let toolStatus: string | null = null

function renderLine(text: string) {
  // 清掉当前行，重新输出
  process.stdout.write('\r' + ' '.repeat(80) + '\r')
  process.stdout.write(text)
}

agent.subscribe((event: AgentEvent) => {
  switch (event.type) {
    case 'agent_start':
      currentLine = '🤖 '
      renderLine(currentLine)
      break

    case 'message_update':
      if (event.assistantMessageEvent.type === 'text_delta') {
        currentLine += event.assistantMessageEvent.delta
        renderLine(currentLine)
      }
      break

    case 'tool_execution_start':
      toolStatus = `🔧 ${event.toolName}...`
      process.stdout.write(`\n${toolStatus}`)
      break

    case 'tool_execution_end':
      const icon = event.isError ? '❌' : '✅'
      process.stdout.write(`\r${icon} ${event.toolName} done`)
      process.stdout.write('\n')
      toolStatus = null
      // 恢复 AI 输出
      renderLine(currentLine)
      break

    case 'agent_end':
      console.log('\n') // 换行，准备下一条
      break

    case 'error':
      console.error('\n💥 Error occurred')
      break
  }
})

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout,
})

function ask() {
  rl.question('You: ', async (input) => {
    if (input === 'exit') {
      rl.close()
      return
    }
    if (input === 'reset') {
      agent.reset()
      console.log('🗑️ History cleared')
      ask()
      return
    }
    await agent.prompt(input)
    ask()
  })
}

console.log('Terminal Chat started. Type "exit" to quit, "reset" to clear history.')
ask()
```

## 运行

```bash
cd demos/04-event-ui
npm install @earendil-works/pi-agent-core @earendil-works/pi-ai @sinclair/typebox
export OPENAI_API_KEY=sk-...
npx tsx index.ts
```

## 观察重点

1. **事件驱动 UI**：没有轮询，没有回调地狱，所有 UI 更新都来自 `subscribe`
2. **状态管理**：`currentLine` 和 `toolStatus` 是简单的局部变量，但足以驱动终端 UI
3. **并发显示**：工具执行时，AI 的回复可能暂停；工具完成后，回复继续

## 与 React 的对应关系

| 终端 UI | React 实现 |
|---------|-----------|
| `currentLine` | `useState<string>` |
| `toolStatus` | `useState<Map<string, ToolStatus>>` |
| `renderLine()` | 组件 re-render |
| `subscribe()` | `useEffect(() => agent.subscribe(...), [])` |
| `agent.prompt()` | 按钮 onClick / 表单 submit |

这个 Demo 的终端逻辑，几乎可以一一对应到 React 组件中。

## 思考题

如果用户在 AI 正在输出时（`isStreaming === true`）发送了新消息，会发生什么？Agent 的 `steeringMode` 如何控制这个行为？

## 下一步

Demo 5 将演示 Steering 和 Follow-up 队列，让你理解如何在 Agent 运行时“插话”。

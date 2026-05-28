# Demo 2：手动 Agent Loop

> 这个 Demo 不借助 `Agent` 类，直接用 `agentLoop` 实现一个“能调用工具”的 AI。目的是让你看清 Agent Loop 的底层机制。

## 目标

实现一个 Agent，它可以：
1. 接收用户提问
2. 调用 LLM
3. 如果 LLM 想调用工具，执行工具并把结果回传
4. 循环直到 LLM 给出最终答案

## 代码

```ts
// demos/02-manual-loop/index.ts
import { agentLoop } from '@earendil-works/pi-agent-core'
import { getModel } from '@earendil-works/pi-ai'
import { Type } from '@sinclair/typebox'
import type { AgentContext, AgentTool, AgentMessage } from '@earendil-works/pi-agent-core'

// 定义一个简单工具：计算器
const calculatorTool: AgentTool = {
  name: 'calculator',
  label: '计算器',
  description: '执行基础数学运算，如加减乘除',
  parameters: Type.Object({
    expression: Type.String({ description: '数学表达式，如 2 + 2' }),
  }),
  execute: async (toolCallId, params) => {
    try {
      // 注意：生产环境不要用 eval！这里仅作演示
      const result = eval(params.expression)
      return {
        content: [{ type: 'text', text: String(result) }],
        details: { expression: params.expression },
      }
    } catch (e) {
      throw new Error(`Invalid expression: ${params.expression}`)
    }
  },
}

const model = getModel('openai', 'gpt-4o-mini')

const context: AgentContext = {
  systemPrompt: 'You are a helpful assistant. Use the calculator tool for math questions.',
  messages: [],
  tools: [calculatorTool],
}

const config = {
  model,
  convertToLlm: (msgs: AgentMessage[]) =>
    msgs.filter((m) => ['user', 'assistant', 'toolResult'].includes(m.role)),
  toolExecution: 'parallel' as const,
}

async function run(prompt: string) {
  const userMessage: AgentMessage = {
    role: 'user',
    content: prompt,
    timestamp: Date.now(),
  }

  for await (const event of agentLoop([userMessage], context, config)) {
    switch (event.type) {
      case 'agent_start':
        console.log('▶️ Agent started')
        break
      case 'turn_start':
        console.log('🔄 New turn')
        break
      case 'message_update':
        if (event.assistantMessageEvent.type === 'text_delta') {
          process.stdout.write(event.assistantMessageEvent.delta)
        }
        break
      case 'tool_execution_start':
        console.log(`\n🔧 Executing ${event.toolName}(${JSON.stringify(event.args)})`)
        break
      case 'tool_execution_end':
        console.log(`\n✅ Tool done (error: ${event.isError})`)
        break
      case 'turn_end':
        console.log('\n⏹️ Turn ended')
        break
      case 'agent_end':
        console.log('\n🏁 Agent finished')
        break
    }
  }

  // agentLoop 返回后，context.messages 已经被更新
  console.log('\n--- Final messages count:', context.messages.length)
}

run('What is 135 * 27?')
```

## 运行

```bash
cd demos/02-manual-loop
npm install @earendil-works/pi-agent-core @earendil-works/pi-ai @sinclair/typebox
export OPENAI_API_KEY=sk-...
npx tsx index.ts
```

## 观察重点

1. **循环自动化**：你不需要写 `while`，`agentLoop` 内部自动处理“有工具调用就继续”的逻辑
2. **context 被修改**：`agentLoop` 会直接修改传入的 `context.messages`，追加新消息
3. **事件顺序**：`turn_start` → `message_update` × N → `tool_execution_start` → `tool_execution_end` → `turn_end` → （可能继续）→ `agent_end`

## 对比 Demo 1

| 维度 | Demo 1 (streamSimple) | Demo 2 (agentLoop) |
|------|----------------------|-------------------|
| 历史记忆 | ❌ 无 | ✅ 自动维护 |
| 工具调用 | ❌ 无 | ✅ 自动识别并执行 |
| 多轮推理 | ❌ 无 | ✅ 自动循环 |
| 代码复杂度 | 低 | 中 |

## 思考题

如果用户连续问两个问题，第二次调用 `run()` 时，`context.messages` 已经包含了第一次的对话。这是特性还是 bug？在什么场景下你需要重置 `context.messages`？

## 下一步

Demo 3 将添加更多工具，并展示并行执行和错误处理。

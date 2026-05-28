# Demo 3：工具调用与执行

> 这个 Demo 扩展工具系统，添加多个工具，演示并行执行、Schema 校验错误、以及 LLM 的自纠正能力。

## 目标

1. 添加 `weather` 和 `search` 两个工具（mock 实现）
2. 演示并行执行模式
3. 故意让 LLM 传错参数，观察错误处理流程

## 代码

```ts
// demos/03-tool-calls/index.ts
import { Agent } from '@earendil-works/pi-agent-core'
import { getModel } from '@earendil-works/pi-ai'
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'

const weatherTool: AgentTool = {
  name: 'weather',
  label: '天气查询',
  description: '查询指定城市的天气',
  parameters: Type.Object({
    city: Type.String(),
    date: Type.Optional(Type.String({ description: '日期，格式 YYYY-MM-DD' })),
  }),
  execute: async (id, params) => {
    // Mock 实现
    const conditions = ['sunny', 'rainy', 'cloudy', 'snowy']
    const condition = conditions[Math.floor(Math.random() * conditions.length)]
    const temp = Math.floor(Math.random() * 30) + 5
    return {
      content: [{ type: 'text', text: `${params.city}: ${condition}, ${temp}°C` }],
      details: { source: 'mock' },
    }
  },
}

const searchTool: AgentTool = {
  name: 'search',
  label: '网页搜索',
  description: '搜索网络信息',
  parameters: Type.Object({
    query: Type.String(),
    limit: Type.Optional(Type.Number({ default: 3 })),
  }),
  execute: async (id, params) => {
    // Mock 实现
    return {
      content: [{ type: 'text', text: `Search results for "${params.query}":\n1. Result A\n2. Result B\n3. Result C` }],
      details: { query: params.query, resultsCount: params.limit || 3 },
    }
  },
}

const agent = new Agent({
  initialState: {
    systemPrompt: 'You are a helpful assistant with access to weather and search tools.',
    model: getModel('openai', 'gpt-4o-mini'),
    tools: [weatherTool, searchTool],
    messages: [],
  },
  convertToLlm: (msgs) => msgs.filter((m) => ['user', 'assistant', 'toolResult'].includes(m.role)),
  toolExecution: 'parallel',
  beforeToolCall: async ({ toolCall, args }) => {
    console.log(`[Before] ${toolCall.name}(${JSON.stringify(args)})`)
  },
  afterToolCall: async ({ toolCall, result, isError }) => {
    console.log(`[After] ${toolCall.name} -> error=${isError}`)
  },
})

agent.subscribe((event) => {
  switch (event.type) {
    case 'message_update':
      if (event.assistantMessageEvent.type === 'text_delta') {
        process.stdout.write(event.assistantMessageEvent.delta)
      }
      break
    case 'tool_execution_start':
      console.log(`\n🔧 ${event.toolName} starting...`)
      break
    case 'tool_execution_end':
      console.log(`\n✅ ${event.toolName} done`)
      break
  }
})

async function main() {
  // 场景 1：并行调用两个工具
  console.log('=== Scene 1: Parallel tools ===')
  await agent.prompt('What is the weather in Beijing and search for " TypeScript tips"')

  // 场景 2：观察 LLM 自纠正（先重置）
  console.log('\n=== Scene 2: Error recovery ===')
  agent.reset()

  // 故意给一个会触发参数错误的提示（某些模型可能直接做对，取决于提示工程）
  // 更可靠的方式是修改工具让它在某些输入下 throw
  const fragileTool: AgentTool = {
    name: 'fragile_echo',
    label: '脆弱回声',
    description: '回传输入，但如果输入包含 "error" 就抛异常',
    parameters: Type.Object({ text: Type.String() }),
    execute: async (id, params) => {
      if (params.text.includes('error')) {
        throw new Error('Fragile tool crashed!')
      }
      return { content: [{ type: 'text', text: params.text }], details: {} }
    },
  }

  agent.state.tools = [fragileTool]
  await agent.prompt('Use the fragile_echo tool with text "hello error world"')
}

main()
```

## 运行

```bash
cd demos/03-tool-calls
npm install @earendil-works/pi-agent-core @earendil-works/pi-ai @sinclair/typebox
export OPENAI_API_KEY=sk-...
npx tsx index.ts
```

## 观察重点

### 1. 并行执行

当 LLM 一次请求多个工具时，你会看到：

```
🔧 weather starting...
🔧 search starting...
✅ search done
✅ weather done
```

两个 `starting` 几乎同时出现，但 `done` 的顺序取决于实际执行时间。

### 2. 错误自纠正

当 `fragile_echo` throw 后，Agent 会自动生成：

```ts
{
  role: 'toolResult',
  toolCallId: '...',
  toolName: 'fragile_echo',
  content: [{ type: 'text', text: 'Fragile tool crashed!' }],
  isError: true,
}
```

LLM 看到这个 `isError: true` 后，通常会尝试修正参数再次调用，或者向用户解释错误。

### 3. before/after 钩子

`beforeToolCall` 和 `afterToolCall` 让你可以在工具执行前后插入逻辑，比如：
- 权限检查
- 审计日志
- 结果脱敏
- 终止信号

## 思考题

如果把 `toolExecution` 改成 `'sequential'`，输出顺序会有什么变化？在什么场景下必须用串行模式？

## 下一步

Demo 4 将把这些事件接入一个简易的 React UI，让你看到流式输出的视觉效果。

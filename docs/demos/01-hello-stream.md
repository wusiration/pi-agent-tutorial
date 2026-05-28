# Demo 1：Hello Stream

> 第一个 Demo 不碰 Agent，先让你感受“流式 LLM 输出”是什么体验。这是理解 Agent 事件流的基础。

## 目标

用 `pi-ai` 的 `streamSimple` 实现一个命令行程序：输入问题，逐字显示 AI 回复。

## 代码

```ts
// demos/01-hello-stream/index.ts
import { streamSimple, getModel } from '@earendil-works/pi-ai'
import * as readline from 'readline'

const rl = readline.createInterface({ input: process.stdin, output: process.stdout })

async function chat(message: string) {
  const model = getModel('openai', 'gpt-4o-mini', {
    baseUrl: 'https://api.openai.com/v1',
  })

  const stream = streamSimple(model, {
    systemPrompt: 'You are a helpful assistant. Keep answers brief.',
    messages: [{ role: 'user', content: message, timestamp: Date.now() }],
  })

  for await (const event of stream) {
    switch (event.type) {
      case 'text_delta':
        process.stdout.write(event.delta)
        break
      case 'done':
        console.log('\n\n[Done]')
        break
      case 'error':
        console.error('\n[Error]', event.error.errorMessage)
        break
    }
  }
}

rl.question('You: ', async (input) => {
  await chat(input)
  rl.close()
})
```

## 运行

```bash
cd demos/01-hello-stream
npm install @earendil-works/pi-ai
export OPENAI_API_KEY=sk-...
npx tsx index.ts
```

## 观察重点

1. **事件粒度**：不是一次性拿到完整回复，而是逐字（`text_delta`）接收
2. **事件完整性**：流以 `done` 或 `error` 结束，中间不会丢数据
3. **无状态**：每次 `chat()` 都是独立的，没有历史记录

## 思考题

如果要在每次回复后追问，当前代码有什么问题？（提示：没有维护 `messages` 数组）

## 下一步

Demo 2 将在此基础上，手动维护消息历史，实现一个“有记忆”的对话循环。

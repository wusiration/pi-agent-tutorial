/**
 * 最小可运行 Agent Loop 示例
 *
 * 这个示例展示了一个不依赖任何框架的 Agent 核心循环：
 * 1. 接收用户输入
 * 2. 调用 Mock LLM（无需 API key）
 * 3. 如果 LLM 想调用工具，执行工具并把结果回传
 * 4. 循环直到 LLM 给出最终答案
 *
 * 运行方式：
 *   npm install
 *   npm run start
 */

import { Type } from '@sinclair/typebox'

// ============================================
// 类型定义（通常放在 shared/types.ts）
// ============================================

interface TextContent {
  type: 'text'
  text: string
}

interface ToolCallContent {
  type: 'toolCall'
  id: string
  name: string
  arguments: Record<string, any>
}

type Content = TextContent | ToolCallContent

interface UserMessage {
  role: 'user'
  content: string
  timestamp: number
}

interface AssistantMessage {
  role: 'assistant'
  content: Content[]
  stopReason: 'stop' | 'toolUse'
  timestamp: number
}

interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: TextContent[]
  isError: boolean
  timestamp: number
}

type Message = UserMessage | AssistantMessage | ToolResultMessage

interface Tool {
  name: string
  description: string
  parameters: any
  execute: (toolCallId: string, params: any) => Promise<{ content: TextContent[] }>
}

interface AgentContext {
  systemPrompt: string
  messages: Message[]
  tools: Tool[]
}

// ============================================
// Mock LLM（无需 API key）
// ============================================

async function mockLLM(
  context: AgentContext
): Promise<AssistantMessage> {
  const lastMessage = context.messages.at(-1)

  // 模拟延迟
  await delay(300)

  // 如果上一条是 toolResult，说明工具已执行完毕，给出最终回答
  if (lastMessage?.role === 'toolResult') {
    const toolResult = lastMessage as ToolResultMessage
    return {
      role: 'assistant',
      content: [{ type: 'text', text: `根据查询结果：${toolResult.content[0].text}` }],
      stopReason: 'stop',
      timestamp: Date.now(),
    }
  }

  const lastUser = context.messages.findLast((m) => m.role === 'user')
  const text = typeof lastUser?.content === 'string' ? lastUser.content : ''

  // 简单规则：如果提到"天气"就调用天气工具
  if (text.includes('天气')) {
    const city = text.match(/(.+?)(?:的)?天气/)?.[1]?.trim() || '北京'
    return {
      role: 'assistant',
      content: [
        { type: 'text', text: `我来查询 ${city} 的天气。` },
        {
          type: 'toolCall',
          id: `call-${Date.now()}`,
          name: 'weather',
          arguments: { city },
        },
      ],
      stopReason: 'toolUse',
      timestamp: Date.now(),
    }
  }

  // 普通回复
  return {
    role: 'assistant',
    content: [{ type: 'text', text: `Mock 回复：你说了 "${text}"` }],
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

// ============================================
// 工具定义
// ============================================

const weatherTool: Tool = {
  name: 'weather',
  description: '查询指定城市的天气',
  parameters: Type.Object({
    city: Type.String({ description: '城市名称' }),
  }),
  execute: async (_id, params) => {
    const conditions = ['晴天', '多云', '小雨', '大雨']
    const condition = conditions[Math.floor(Math.random() * conditions.length)]
    const temp = Math.floor(Math.random() * 20) + 10
    return {
      content: [{ type: 'text', text: `${params.city}：${condition}，${temp}°C` }],
    }
  },
}

// ============================================
// Agent Loop（核心）
// ============================================

async function runAgentLoop(
  userMessage: string,
  context: AgentContext
): Promise<void> {
  // 1. 添加用户消息
  const userMsg: UserMessage = {
    role: 'user',
    content: userMessage,
    timestamp: Date.now(),
  }
  context.messages.push(userMsg)

  console.log(`\n👤 用户: ${userMessage}`)

  // 2. 调用 LLM
  const assistantMsg = await mockLLM(context)
  context.messages.push(assistantMsg)

  // 3. 打印回复文本
  const text = assistantMsg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('')
  console.log(`🤖 助手: ${text}`)

  // 4. 检查是否有工具调用
  const toolCalls = assistantMsg.content.filter(
    (c): c is ToolCallContent => c.type === 'toolCall'
  )

  if (toolCalls.length === 0) {
    console.log('✅ 对话结束')
    return
  }

  // 5. 执行工具
  for (const tc of toolCalls) {
    const tool = context.tools.find((t) => t.name === tc.name)
    if (!tool) {
      console.log(`❌ 工具未找到: ${tc.name}`)
      continue
    }

    console.log(`🔧 执行工具: ${tc.name}(${JSON.stringify(tc.arguments)})`)
    const result = await tool.execute(tc.id, tc.arguments)

    // 6. 添加工具结果到上下文
    const toolResult: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: tc.id,
      toolName: tc.name,
      content: result.content,
      isError: false,
      timestamp: Date.now(),
    }
    context.messages.push(toolResult)

    console.log(`📋 工具结果: ${result.content[0].text}`)
  }

  // 7. 继续循环（让 LLM 对工具结果做出回应）
  console.log('🔄 继续下一轮...')
  const nextAssistant = await mockLLM(context)
  context.messages.push(nextAssistant)

  const nextText = nextAssistant.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('')
  console.log(`🤖 助手: ${nextText}`)
  console.log('✅ 对话结束')
}

// ============================================
// 辅助函数
// ============================================

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// ============================================
// 入口
// ============================================

async function main() {
  const context: AgentContext = {
    systemPrompt: 'You are a helpful assistant.',
    messages: [],
    tools: [weatherTool],
  }

  console.log('=== 最小 Agent Loop 示例 ===')
  console.log('输入 "退出" 结束对话\n')

  // 模拟对话 1：普通问题
  await runAgentLoop('你好！', context)

  // 模拟对话 2：触发工具调用
  await runAgentLoop('北京天气怎么样？', context)

  // 模拟对话 3：再次触发工具
  await runAgentLoop('上海呢？', context)

  console.log('\n=== 对话历史 ===')
  for (const msg of context.messages) {
    if (msg.role === 'user') {
      console.log(`👤 ${msg.content}`)
    } else if (msg.role === 'assistant') {
      const text = msg.content
        .filter((c): c is TextContent => c.type === 'text')
        .map((c) => c.text)
        .join('')
      console.log(`🤖 ${text}`)
    } else if (msg.role === 'toolResult') {
      console.log(`📋 ${msg.content[0].text}`)
    }
  }
}

main().catch(console.error)

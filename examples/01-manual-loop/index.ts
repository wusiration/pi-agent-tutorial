/**
 * ============================================================================
 * 最小可运行 Agent Loop 示例（手动实现版）
 * ============================================================================
 *
 * 这个示例展示了一个不依赖任何框架的 Agent 核心循环，
 * 帮助你理解 "Agent" 的本质：LLM + 工具调用 + 循环反馈。
 *
 * ---------------------------------------------------------------------------
 * 核心概念（Agent = LLM + Tools + Loop）
 * ---------------------------------------------------------------------------
 *
 * 【Before Agent】传统 ChatBot 的工作方式：
 *   用户提问 → LLM 直接回答 → 结束
 *   问题：LLM 无法获取实时信息（天气、股价、数据库查询等），只能"编"答案。
 *
 * 【With Agent】Agent 的工作方式：
 *   用户提问 → LLM 判断是否需要工具 → 调用工具 → 获取结果 → LLM 基于结果回答
 *   优势：LLM 可以动态使用外部能力，回答更准确、更实时。
 *
 * ---------------------------------------------------------------------------
 * 本示例的 Agent 循环流程：
 *   1. 接收用户输入
 *   2. 调用 Mock LLM（无需 API key，本地模拟）
 *   3. 如果 LLM 想调用工具，执行工具并把结果回传
 *   4. 循环直到 LLM 给出最终答案
 *
 * ---------------------------------------------------------------------------
 * 运行方式：
 *   npm install
 *   npm run start
 * ============================================================================
 */

import { Type } from '@sinclair/typebox'

// ============================================
// 类型定义（通常放在 shared/types.ts）
// ============================================
//
// 这些类型定义了 Agent 系统中消息的三种角色：
//   - user:       人类用户发送的文本消息
//   - assistant:  LLM 的回复，可能包含纯文本，也可能包含工具调用请求
//   - toolResult: 工具执行后的结果，回传给 LLM 供其参考
//
// 这种消息结构是大多数 Agent 框架（如 LangChain、AutoGen）的基础。

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
//
// 这里用本地规则模拟 LLM 的行为，实际项目中应替换为 OpenAI / Claude / 本地模型等。
//
// Mock LLM 的核心逻辑：
//   1. 如果上一条消息是 toolResult → LLM 基于工具结果给出最终回答
//   2. 如果用户消息包含"天气" → LLM 决定调用 weather 工具
//   3. 如果用户消息包含"计算" → LLM 决定调用 calculator 工具
//   4. 否则 → 普通文本回复
//
// 这模拟了真实 LLM 的 "function calling" 能力：LLM 根据用户意图选择工具。

async function mockLLM(
  context: AgentContext
): Promise<AssistantMessage> {
  const lastMessage = context.messages.at(-1)

  // 模拟网络延迟，让输出更有真实感
  await delay(300)

  // ==========================================================================
  // 场景 A：上一条消息是 toolResult → LLM 基于工具结果给出最终回答
  // ==========================================================================
  // 这是 Agent 循环的关键：工具执行完后，必须再次调用 LLM，让 LLM
  // "阅读"工具结果并生成人类可读的最终答案。
  //
  // 例如：
  //   工具结果：{"city": "北京", "condition": "晴天", "temp": 25}
  //   LLM 回答："北京今天晴天，气温 25°C，适合出门！"
  // ==========================================================================
  if (lastMessage?.role === 'toolResult') {
    const toolResult = lastMessage as ToolResultMessage
    return {
      role: 'assistant',
      content: [{ type: 'text', text: `根据查询结果：${toolResult.content[0].text}` }],
      stopReason: 'stop',
      timestamp: Date.now(),
    }
  }

  // 找到最近一条用户消息，用于判断意图
  const lastUser = context.messages.findLast((m) => m.role === 'user')
  const text = typeof lastUser?.content === 'string' ? lastUser.content : ''

  // ==========================================================================
  // 场景 B：用户询问天气 → LLM 决定调用 weather 工具
  // ==========================================================================
  // 在真实 LLM 中，这是通过 "function calling" 实现的：
  // LLM 看到工具描述后，判断 "查询天气" 需要调用 weather 工具。
  // ==========================================================================
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

  // ==========================================================================
  // 场景 C：用户请求计算 → LLM 决定调用 calculator 工具
  // ==========================================================================
  // 演示多工具场景：同一个 Agent 可以拥有多个工具，LLM 根据意图选择。
  // 这里用简单正则提取算式，真实 LLM 会自己构造参数。
  // ==========================================================================
  if (text.includes('计算') || /[\d+\-*/().\s]+/.test(text)) {
    // 尝试提取算式，例如 "计算 1+2*3" 或 "1 + 2 等于多少"
    const exprMatch = text.match(/计算\s*([\d+\-*/().\s]+)/)
      || text.match(/([\d+\-*/().\s]{3,})/)
    const expression = exprMatch ? exprMatch[1].trim() : '1 + 1'

    return {
      role: 'assistant',
      content: [
        { type: 'text', text: `我来计算 ${expression}。` },
        {
          type: 'toolCall',
          id: `call-${Date.now()}`,
          name: 'calculator',
          arguments: { expression },
        },
      ],
      stopReason: 'toolUse',
      timestamp: Date.now(),
    }
  }

  // ==========================================================================
  // 场景 D：普通闲聊 → LLM 直接文本回复（无需工具）
  // ==========================================================================
  // 这是传统 ChatBot 的行为。Agent 的优势在于：它既能闲聊，也能在需要时
  // 自动切换到工具调用模式。
  // ==========================================================================
  return {
    role: 'assistant',
    content: [{ type: 'text', text: `Mock 回复：你说了 "${text}"` }],
    stopReason: 'stop',
    timestamp: Date.now(),
  }
}

// ============================================
// 工具定义（Tool Definitions）
// ============================================
//
// 工具是 Agent 的"手脚"——让 LLM 能够执行代码、查询数据库、调用 API 等。
// 每个工具包含：
//   - name:        工具名称（LLM 通过名称调用）
//   - description: 工具描述（帮助 LLM 理解何时使用该工具）
//   - parameters:  参数 Schema（用 JSON Schema 描述，这里用 TypeBox）
//   - execute:     实际执行逻辑
//
// 【多工具演示】本示例定义了 2 个工具：
//   1. weather    - 查询城市天气（模拟外部 API 调用）
//   2. calculator - 数学计算器（演示 LLM 分解多步计算）

// ----------------------------------------------------------------------------
// 工具 1：天气查询（模拟外部 API）
// ----------------------------------------------------------------------------
const weatherTool: Tool = {
  name: 'weather',
  description: '查询指定城市的天气状况，返回天气描述和温度',
  parameters: Type.Object({
    city: Type.String({ description: '城市名称，例如：北京、上海、广州' }),
  }),
  execute: async (_id, params) => {
    // 模拟真实 API 的随机返回（实际项目中这里会调用天气 API）
    const conditions = ['晴天', '多云', '小雨', '大雨']
    const condition = conditions[Math.floor(Math.random() * conditions.length)]
    const temp = Math.floor(Math.random() * 20) + 10 // 10~30°C
    return {
      content: [{ type: 'text', text: `${params.city}：${condition}，${temp}°C` }],
    }
  },
}

// ----------------------------------------------------------------------------
// 工具 2：数学计算器（演示 LLM 使用多个工具）
// ----------------------------------------------------------------------------
// 这个工具展示了 Agent 的另一大用途：让 LLM 执行精确的数学运算。
// LLM 本身不擅长算术（容易算错 12345 * 67890），但借助 calculator
// 工具，它可以得到精确结果。
// ----------------------------------------------------------------------------
const calculatorTool: Tool = {
  name: 'calculator',
  description: '执行数学表达式计算，支持 + - * / 和括号',
  parameters: Type.Object({
    expression: Type.String({ description: '数学表达式，例如："1 + 2 * 3"、"(100 - 25) / 5"' }),
  }),
  execute: async (_id, params) => {
    const { expression } = params
    try {
      // 安全计算：只允许数字和运算符（生产环境应使用更安全的方式）
      const sanitized = expression.replace(/[^\d+\-*/().\s]/g, '')
      // eslint-disable-next-line no-eval
      const result = eval(sanitized)
      return {
        content: [{ type: 'text', text: `${expression} = ${result}` }],
      }
    } catch (e) {
      return {
        content: [{ type: 'text', text: `计算错误：${(e as Error).message}` }],
      }
    }
  },
}

// ============================================
// Agent Loop（核心循环）
// ============================================
//
// 这是整个 Agent 的"大脑调度器"。循环逻辑如下：
//
//   ┌─────────────────────────────────────────┐
//   │  1. 用户输入消息，加入对话历史            │
//   │  2. 调用 LLM，获取回复                    │
//   │  3. 提取回复中的文本，打印给用户          │
//   │  4. 检查 LLM 是否请求调用工具             │
//   │     ├─ 没有工具调用 → 对话结束 ✅         │
//   │     └─ 有工具调用 → 继续下一步            │
//   │  5. 遍历每个工具调用请求：                │
//   │     a. 根据名称找到对应工具               │
//   │     b. 执行工具，获取结果                 │
//   │     c. 将 toolResult 加入对话历史         │
//   │  6. 再次调用 LLM，让 LLM 基于工具结果回答 │
//   │  7. 打印最终回答，对话结束 ✅              │
//   └─────────────────────────────────────────┘
//
// 注意：这是一个简化的单轮循环。真实 Agent 可能需要多轮工具调用
// （例如：先查天气，再查交通，最后给出出行建议）。

async function runAgentLoop(
  userMessage: string,
  context: AgentContext
): Promise<void> {
  // --------------------------------------------------------------------------
  // Step 1: 将用户消息加入对话历史
  // --------------------------------------------------------------------------
  // 对话历史（messages）是 Agent 的"记忆"。每次调用 LLM 时，都会把
  // 完整历史传过去，让 LLM 了解上下文。这是实现多轮对话的关键。
  // --------------------------------------------------------------------------
  const userMsg: UserMessage = {
    role: 'user',
    content: userMessage,
    timestamp: Date.now(),
  }
  context.messages.push(userMsg)

  console.log(`\n👤 用户: ${userMessage}`)

  // --------------------------------------------------------------------------
  // Step 2: 调用 LLM，获取回复
  // --------------------------------------------------------------------------
  // LLM 的回复可能包含：
  //   - 纯文本（直接回答）
  //   - 文本 + toolCall（想调用工具）
  //   - 多个 toolCall（需要并行执行多个工具）
  // --------------------------------------------------------------------------
  const assistantMsg = await mockLLM(context)
  context.messages.push(assistantMsg)

  // --------------------------------------------------------------------------
  // Step 3: 提取并打印 LLM 的文本回复
  // --------------------------------------------------------------------------
  const text = assistantMsg.content
    .filter((c): c is TextContent => c.type === 'text')
    .map((c) => c.text)
    .join('')
  console.log(`🤖 助手: ${text}`)

  // --------------------------------------------------------------------------
  // Step 4: 检查 LLM 是否请求调用工具
  // --------------------------------------------------------------------------
  const toolCalls = assistantMsg.content.filter(
    (c): c is ToolCallContent => c.type === 'toolCall'
  )

  // 如果没有工具调用，说明 LLM 已经直接回答了问题，对话结束
  if (toolCalls.length === 0) {
    console.log('✅ 对话结束（无需工具）')
    return
  }

  // --------------------------------------------------------------------------
  // Step 5: 执行工具调用
  // --------------------------------------------------------------------------
  // 遍历每个 toolCall，找到对应的工具并执行。
  // 注意：真实场景中，多个工具调用可以并行执行（Promise.all）。
  // --------------------------------------------------------------------------
  for (const tc of toolCalls) {
    const tool = context.tools.find((t) => t.name === tc.name)
    if (!tool) {
      console.log(`❌ 工具未找到: ${tc.name}`)
      continue
    }

    console.log(`🔧 执行工具: ${tc.name}(${JSON.stringify(tc.arguments)})`)
    const result = await tool.execute(tc.id, tc.arguments)

    // ------------------------------------------------------------------------
    // Step 6: 将工具结果加入对话历史
    // ------------------------------------------------------------------------
    // 这是 Agent 循环最关键的一步！工具结果必须作为 message 回传给 LLM，
    // 否则 LLM 不知道工具执行了什么。toolCallId 用于将结果与调用关联。
    // ------------------------------------------------------------------------
    const toolResult: ToolResultMessage = {
      role: 'toolResult',
      toolCallId: tc.id,   // 必须与对应的 toolCall.id 一致
      toolName: tc.name,
      content: result.content,
      isError: false,
      timestamp: Date.now(),
    }
    context.messages.push(toolResult)

    console.log(`📋 工具结果: ${result.content[0].text}`)
  }

  // --------------------------------------------------------------------------
  // Step 7: 再次调用 LLM，让 LLM 基于工具结果生成最终回答
  // --------------------------------------------------------------------------
  // 为什么需要再次调用？因为第一次 LLM 只"决定"了调用什么工具，
  // 但还没看到工具返回的数据。第二次调用时，对话历史中已经有了
  // toolResult，LLM 可以基于真实数据给出准确回答。
  // --------------------------------------------------------------------------
  console.log('🔄 工具执行完毕，再次调用 LLM 生成最终回答...')
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
// 入口：运行示例对话
// ============================================
//
// 本示例演示了 4 种对话场景：
//   1. 普通闲聊（不触发工具）
//   2. 查询天气（触发 weather 工具）
//   3. 数学计算（触发 calculator 工具）
//   4. 复杂计算（触发多次 calculator 工具，展示多步推理）
//
// 最后打印完整的对话历史，展示 Agent 如何维护上下文。

async function main() {
  // 初始化 Agent 上下文：系统提示 + 空对话历史 + 可用工具列表
  const context: AgentContext = {
    systemPrompt: 'You are a helpful assistant.',
    messages: [],
    tools: [weatherTool, calculatorTool], // 注册 2 个工具
  }

  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║        最小 Agent Loop 示例（手动实现版）                     ║')
  console.log('║  演示：LLM 如何根据用户意图自动选择并调用工具                 ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')

  // --------------------------------------------------------------------------
  // 对话 1：普通闲聊（不触发工具）
  // --------------------------------------------------------------------------
  // 用户只是打招呼，LLM 判断不需要任何工具，直接文本回复。
  // 这就是传统 ChatBot 的行为。
  // --------------------------------------------------------------------------
  await runAgentLoop('你好！', context)

  // --------------------------------------------------------------------------
  // 对话 2：查询天气（触发 weather 工具）
  // --------------------------------------------------------------------------
  // 用户问天气，LLM 判断需要调用 weather 工具。
  // 流程：用户提问 → LLM 返回 toolCall → 执行 weather → 结果回传 → LLM 最终回答
  // --------------------------------------------------------------------------
  await runAgentLoop('北京天气怎么样？', context)

  // --------------------------------------------------------------------------
  // 对话 3：再次查询天气（展示上下文记忆）
  // --------------------------------------------------------------------------
  // Agent 记住了之前的对话，LLM 可以看到完整历史。
  // --------------------------------------------------------------------------
  await runAgentLoop('上海天气怎么样？', context)

  // --------------------------------------------------------------------------
  // 对话 4：数学计算（触发 calculator 工具）
  // --------------------------------------------------------------------------
  // 演示多工具场景：同一个 Agent 拥有 weather + calculator，
  // LLM 根据用户问题自动选择正确的工具。
  // --------------------------------------------------------------------------
  await runAgentLoop('计算 (100 + 25) * 8', context)

  // --------------------------------------------------------------------------
  // 打印完整对话历史
  // --------------------------------------------------------------------------
  // 观察消息序列，可以看到 Agent 循环的完整轨迹：
  //   user → assistant(toolCall) → toolResult → assistant(stop)
  // --------------------------------------------------------------------------
  console.log('\n══════════════════════════════════════════════════════════════')
  console.log('📜 完整对话历史（消息序列）：')
  console.log('══════════════════════════════════════════════════════════════')
  for (const msg of context.messages) {
    if (msg.role === 'user') {
      console.log(`👤 [user]       ${msg.content}`)
    } else if (msg.role === 'assistant') {
      const text = msg.content
        .filter((c): c is TextContent => c.type === 'text')
        .map((c) => c.text)
        .join('')
      const hasToolCall = msg.content.some((c) => c.type === 'toolCall')
      const label = hasToolCall ? 'assistant+tool' : 'assistant'
      const icon = hasToolCall ? '🔧' : '🤖'
      console.log(`${icon} [${label}]  ${text}${hasToolCall ? ' [请求调用工具]' : ''}`)
    } else if (msg.role === 'toolResult') {
      console.log(`📋 [toolResult] ${msg.content[0].text} (toolCallId: ${msg.toolCallId})`)
    }
  }

  console.log('\n✅ 示例运行完毕！')
  console.log('')
  console.log('💡 关键 takeaway：')
  console.log('   1. Agent = LLM + 工具 + 循环反馈')
  console.log('   2. toolResult 必须回传给 LLM，否则 LLM 不知道工具执行了什么')
  console.log('   3. 同一个 Agent 可以注册多个工具，LLM 根据意图自动选择')
  console.log('   4. 对话历史（messages）是 Agent 的"记忆"，必须完整保存')
}

main().catch(console.error)

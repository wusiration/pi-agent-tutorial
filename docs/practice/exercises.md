# 详细练习与解答

> 每个练习包含：问题描述、起始代码、预期输出、解答（折叠隐藏）、提示。建议先独立完成，再展开查看解答。

---

## 练习 1：修复损坏的工具 Schema

### 问题描述

下面的工具定义有 3 处错误，导致 LLM 无法正确理解参数要求。请找出并修复。

### 起始代码

```ts
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'

const weatherTool: AgentTool = {
  name: 'weather',
  label: '天气查询',
  description: '查询指定城市的天气',
  parameters: Type.Object({
    city: Type.String,
    unit: Type.Enum(['celsius', 'fahrenheit']),
    date: Type.Optional(Type.String({ description: '日期格式 YYYY-MM-DD' })),
    includeForecast: Type.Boolean({ default: true }),
  }),
  execute: async (id, params) => {
    return {
      content: [{ type: 'text', text: `${params.city}: 18°C, sunny` }],
      details: {},
    }
  },
}
```

### 预期输出

修复后，以下测试用例应该通过：

```ts
// 测试 1：基本调用
weatherTool.execute('call-1', { city: '北京', unit: 'celsius' })
// → { content: [{ type: 'text', text: '北京: 18°C, sunny' }], details: {} }

// 测试 2：缺少必填参数应该在校验阶段报错
// { city: '北京' } → 错误：缺少 unit

// 测试 3：可选参数可以省略
// { city: '北京', unit: 'fahrenheit', date: '2024-06-01' } → 正常执行
```

### 提示

<details>
<summary>💡 提示 1：TypeBox 的语法</summary>

`Type.String` 是类型对象本身，调用时需要加括号：`Type.String()`。`Type.Enum` 的参数格式也需要注意。

</details>

<details>
<summary>💡 提示 2：必填与可选</summary>

哪些参数应该是必填的？`unit` 没有 `Type.Optional` 包裹，但测试用例 2 说缺少 `unit` 应该报错——这其实是正确的行为。再仔细看，问题可能出在其他地方。

</details>

<details>
<summary>💡 提示 3：默认值</summary>

TypeBox 的 `default` 只在 JSON Schema 层面声明，不会在运行时自动填充缺失值。如果需要默认值，应该在 `execute` 中处理，或者使用 `Typebox` 的 `Value.Default`。

</details>

### 解答

<details>
<summary>✅ 点击查看解答</summary>

```ts
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'

const weatherTool: AgentTool = {
  name: 'weather',
  label: '天气查询',
  description: '查询指定城市的天气',
  parameters: Type.Object({
    // 错误 1：Type.String 缺少括号
    city: Type.String(),

    // 错误 2：Type.Enum 的参数应该是对象，不是数组
    unit: Type.Enum({ celsius: 'celsius', fahrenheit: 'fahrenheit' }),

    date: Type.Optional(Type.String({ description: '日期格式 YYYY-MM-DD' })),

    // 错误 3：TypeBox 的 default 不会自动填充运行时值
    // 方案 A：在 execute 中处理默认值
    includeForecast: Type.Optional(Type.Boolean()),
  }),
  execute: async (id, params) => {
    // 处理默认值
    const includeForecast = params.includeForecast ?? true
    return {
      content: [{ type: 'text', text: `${params.city}: 18°C, sunny` }],
      details: { includeForecast },
    }
  },
}
```

**3 处错误总结**：

| 错误 | 位置 | 原因 |
|------|------|------|
| `Type.String` → `Type.String()` | `city` 字段 | TypeBox 类型是工厂函数，必须调用 |
| `Type.Enum([...])` → `Type.Enum({...})` | `unit` 字段 | `Type.Enum` 接收对象映射，不是数组 |
| `default` 不会自动填充 | `includeForecast` | TypeBox Schema 的 `default` 仅用于文档/校验，运行时需手动处理 |

</details>

---

## 练习 2：为 Mini Agent CLI 添加货币转换工具

### 问题描述

在 `examples/06-mini-agent-cli` 的基础上，添加一个 `currency_converter` 工具，支持将一种货币转换为另一种货币。

要求：
1. 工具名：`currency_converter`
2. 参数：`amount`（数字）、`from`（字符串，如 "USD"）、`to`（字符串，如 "CNY"）
3. 使用模拟汇率（不需要调用真实 API）
4. 如果 `from` 或 `to` 不在支持的货币列表中，抛出错误

### 起始代码

基于 `examples/06-mini-agent-cli/index.ts`，在工具定义数组中添加：

```ts
// TODO：在这里添加 currency_converter 工具
const currencyConverterTool: AgentTool = {
  // ...
}
```

### 预期输出

```
> 把 100 美元换成人民币
🤖 我来帮你转换 100 USD 到 CNY。
🔧 执行工具: currency_converter({"amount":100,"from":"USD","to":"CNY"})
📋 工具结果: 100 USD = 720 CNY
🤖 100 美元约等于 720 人民币。

> 把 50 比特币换成欧元
🤖 我来尝试转换...
🔧 执行工具: currency_converter({"amount":50,"from":"BTC","to":"EUR"})
❌ 工具执行失败: 不支持的货币: BTC
🤖 抱歉，目前不支持比特币（BTC）的转换。支持的货币有：USD, CNY, EUR, JPY, GBP。
```

### 提示

<details>
<summary>💡 提示 1：汇率表设计</summary>

用一个对象存储汇率，以某个基准货币（如 USD）为锚：

```ts
const rates: Record<string, number> = {
  USD: 1,
  CNY: 7.2,
  EUR: 0.92,
  JPY: 150,
  GBP: 0.79,
}
```

转换公式：`amount / rates[from] * rates[to]`

</details>

<details>
<summary>💡 提示 2：错误处理</summary>

在 `execute` 中检查货币是否支持，如果不支持则 `throw new Error('不支持的货币: ' + from)`。Agent 会自动捕获错误并生成 `isError: true` 的工具结果。

</details>

### 解答

<details>
<summary>✅ 点击查看解答</summary>

```ts
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'

const currencyConverterTool: AgentTool = {
  name: 'currency_converter',
  label: '货币转换',
  description: '将一种货币转换为另一种货币，支持 USD、CNY、EUR、JPY、GBP',
  parameters: Type.Object({
    amount: Type.Number({ description: '要转换的金额' }),
    from: Type.String({ description: '源货币代码，如 USD' }),
    to: Type.String({ description: '目标货币代码，如 CNY' }),
  }),
  execute: async (id, params) => {
    const rates: Record<string, number> = {
      USD: 1,
      CNY: 7.2,
      EUR: 0.92,
      JPY: 150,
      GBP: 0.79,
    }

    const supportedCurrencies = Object.keys(rates)

    if (!supportedCurrencies.includes(params.from)) {
      throw new Error(`不支持的货币: ${params.from}。支持的货币有: ${supportedCurrencies.join(', ')}`)
    }
    if (!supportedCurrencies.includes(params.to)) {
      throw new Error(`不支持的货币: ${params.to}。支持的货币有: ${supportedCurrencies.join(', ')}`)
    }

    const converted = params.amount / rates[params.from] * rates[params.to]
    const rounded = Math.round(converted * 100) / 100

    return {
      content: [{ type: 'text', text: `${params.amount} ${params.from} = ${rounded} ${params.to}` }],
      details: { rate: rates[params.to] / rates[params.from] },
    }
  },
}
```

**使用方式**：将 `currencyConverterTool` 加入 Agent 的 `tools` 数组即可。

</details>

---

## 练习 3：在自定义 Agent Loop 中实现 maxTurns 限制

### 问题描述

以下是一个简化版的 Agent Loop，但它有一个严重问题：如果 LLM 一直决定调用工具，循环将永远运行下去。请添加 `maxTurns` 限制，当循环次数超过阈值时优雅退出。

### 起始代码

```ts
async function* customAgentLoop(
  userMessage: string,
  tools: AgentTool[],
  maxTurns: number = 10,
): AsyncGenerator<{ type: string; data?: any }> {
  const messages: Message[] = [{ role: 'user', content: userMessage }]

  // TODO：添加 turn 计数和 maxTurns 检查

  while (true) {
    yield { type: 'turn_start', data: { turn: /* TODO */ } }

    const response = await callMockLLM(messages, tools)

    if (response.type === 'text') {
      messages.push({ role: 'assistant', content: response.text })
      yield { type: 'text', data: response.text }
      break
    }

    if (response.type === 'tool_calls') {
      yield { type: 'tool_calls', data: response.calls }

      for (const call of response.calls) {
        const tool = tools.find((t) => t.name === call.name)
        if (!tool) {
          yield { type: 'tool_error', data: { name: call.name, error: 'Tool not found' } }
          continue
        }
        const result = await tool.execute(call.id, call.args)
        messages.push({ role: 'toolResult', content: result.content[0].text })
        yield { type: 'tool_result', data: result }
      }
    }
  }

  yield { type: 'agent_end' }
}
```

### 预期输出

当 `maxTurns = 3` 且 LLM 每次都返回 `tool_calls` 时：

```
turn_start { turn: 1 }
tool_calls [...]
tool_result [...]
turn_start { turn: 2 }
tool_calls [...]
tool_result [...]
turn_start { turn: 3 }
tool_calls [...]
tool_result [...]
error { message: '达到最大轮次限制 (maxTurns=3)，循环已终止' }
agent_end
```

### 提示

<details>
<summary>💡 提示 1：计数器位置</summary>

在 `while` 循环前初始化 `let turn = 0`，在每次循环开始时递增。注意：第一次 LLM 调用就是第 1 轮。

</details>

<details>
<summary>💡 提示 2：退出条件</summary>

在循环开头检查 `if (turn >= maxTurns)`，生成错误事件后 `return` 或 `break`。

</details>

<details>
<summary>💡 提示 3：边界情况</summary>

如果 `maxTurns = 0`，应该立即退出还是允许至少一轮？通常 `maxTurns` 应该至少为 1，但你的代码应该能处理极端输入。

</details>

### 解答

<details>
<summary>✅ 点击查看解答</summary>

```ts
async function* customAgentLoop(
  userMessage: string,
  tools: AgentTool[],
  maxTurns: number = 10,
): AsyncGenerator<{ type: string; data?: any }> {
  const messages: Message[] = [{ role: 'user', content: userMessage }]

  // 防御性校验
  if (maxTurns < 1) {
    yield { type: 'error', data: { message: 'maxTurns 必须至少为 1' } }
    yield { type: 'agent_end' }
    return
  }

  let turn = 0

  while (true) {
    turn++

    // 在每次 turn 开始时检查限制
    if (turn > maxTurns) {
      yield {
        type: 'error',
        data: { message: `达到最大轮次限制 (maxTurns=${maxTurns})，循环已终止` },
      }
      break
    }

    yield { type: 'turn_start', data: { turn } }

    const response = await callMockLLM(messages, tools)

    if (response.type === 'text') {
      messages.push({ role: 'assistant', content: response.text })
      yield { type: 'text', data: response.text }
      break
    }

    if (response.type === 'tool_calls') {
      yield { type: 'tool_calls', data: response.calls }

      for (const call of response.calls) {
        const tool = tools.find((t) => t.name === call.name)
        if (!tool) {
          yield { type: 'tool_error', data: { name: call.name, error: 'Tool not found' } }
          continue
        }
        const result = await tool.execute(call.id, call.args)
        messages.push({ role: 'toolResult', content: result.content[0].text })
        yield { type: 'tool_result', data: result }
      }
    }
  }

  yield { type: 'agent_end' }
}
```

**关键设计点**：

1. **防御性校验**：`maxTurns < 1` 时立即退出，避免死循环
2. **先检查再执行**：`turn++` 后立即判断 `turn > maxTurns`，确保不会多执行一轮
3. **优雅退出**：生成 `error` 事件后 `break`，最后统一生成 `agent_end`
4. **事件完整性**：无论正常结束还是异常退出，都保证 `agent_end` 被发出

</details>

---

## 练习 4：在工具执行中途处理 Abort

### 问题描述

以下是一个模拟长时间网络请求的工具。用户可能在请求过程中按下 `/abort` 取消操作。请修改代码，使其能响应 `AbortSignal` 并在取消时进行资源清理。

### 起始代码

```ts
const fetchDataTool: AgentTool = {
  name: 'fetch_data',
  label: '获取数据',
  description: '从远程服务器获取数据（模拟耗时 5 秒）',
  parameters: Type.Object({
    url: Type.String({ description: '要获取的 URL' }),
  }),
  execute: async (id, params) => {
    // 模拟 5 个阶段的请求，每阶段 1 秒
    for (let i = 0; i < 5; i++) {
      await new Promise((r) => setTimeout(r, 1000))
      console.log(`  [fetch_data] 阶段 ${i + 1}/5 完成`)
    }

    return {
      content: [{ type: 'text', text: `Data from ${params.url}: {...}` }],
      details: { duration: 5000 },
    }
  },
}
```

### 预期输出

**正常完成**：

```
🔧 执行工具: fetch_data({"url":"https://api.example.com/data"})
  [fetch_data] 阶段 1/5 完成
  [fetch_data] 阶段 2/5 完成
  [fetch_data] 阶段 3/5 完成
  [fetch_data] 阶段 4/5 完成
  [fetch_data] 阶段 5/5 完成
📋 工具结果: Data from https://api.example.com/data: {...}
```

**用户取消（在第 2 阶段后触发 abort）**：

```
🔧 执行工具: fetch_data({"url":"https://api.example.com/data"})
  [fetch_data] 阶段 1/5 完成
  [fetch_data] 阶段 2/5 完成
❌ 工具执行失败: 用户已取消操作
🤖 操作已取消，没有获取到数据。
```

### 提示

<details>
<summary>💡 提示 1：AbortSignal 的用法</summary>

`AgentTool.execute` 的第三个参数是 `signal?: AbortSignal`。你可以在每个阶段后检查 `signal.aborted`，或者使用 `signal.throwIfAborted()`。

</details>

<details>
<summary>💡 提示 2：清理资源</summary>

如果工具持有需要释放的资源（如文件句柄、数据库连接），在检测到 abort 后应该进行清理。本练习中只需确保循环能提前退出。

</details>

<details>
<summary>💡 提示 3：错误消息</summary>

当检测到 abort 时，应该 `throw new Error('用户已取消操作')`。Agent 会自动将这个错误转换为 `isError: true` 的工具结果。

</details>

### 解答

<details>
<summary>✅ 点击查看解答</summary>

```ts
const fetchDataTool: AgentTool = {
  name: 'fetch_data',
  label: '获取数据',
  description: '从远程服务器获取数据（模拟耗时 5 秒）',
  parameters: Type.Object({
    url: Type.String({ description: '要获取的 URL' }),
  }),
  execute: async (id, params, signal) => {
    // 模拟 5 个阶段的请求，每阶段 1 秒
    for (let i = 0; i < 5; i++) {
      // 方案 1：主动检查
      if (signal?.aborted) {
        console.log(`  [fetch_data] 检测到取消信号，正在清理...`)
        // 这里可以进行资源清理：关闭连接、释放锁等
        throw new Error('用户已取消操作')
      }

      // 方案 2：使用 throwIfAborted（更简洁）
      // signal?.throwIfAborted()

      await new Promise((r) => setTimeout(r, 1000))
      console.log(`  [fetch_data] 阶段 ${i + 1}/5 完成`)
    }

    // 最终检查：防止在最后一阶段完成后、返回前被 abort
    signal?.throwIfAborted()

    return {
      content: [{ type: 'text', text: `Data from ${params.url}: {...}` }],
      details: { duration: 5000 },
    }
  },
}
```

**关键设计点**：

1. **协作式取消**：工具定期检查 `signal.aborted`，而不是被强制中断
2. **资源清理**：在 `throw` 之前可以添加清理逻辑（关闭文件、释放连接等）
3. **最终检查**：在 `return` 前再次检查，防止"完成后立刻被取消"的竞态条件
4. **错误信息**：抛出的错误会被 Agent 包装为 `isError: true` 的结果，LLM 可以看到并决定如何回应

**进阶思考**：如果 `await new Promise` 是一个真实的 `fetch()` 调用，应该怎么做？

```ts
// 真实 fetch 的 abort 方式
const controller = new AbortController()
signal?.addEventListener('abort', () => controller.abort())

const response = await fetch(params.url, { signal: controller.signal })
```

</details>

---

## Mini Project：代码审查 Agent

### 项目描述

构建一个"代码审查 Agent"，它可以读取本地文件、分析代码质量，并给出改进建议。

### 功能要求

1. **读取文件**：添加 `read_file` 工具，读取指定路径的代码文件
2. **代码分析**：添加 `analyze_code` 工具，返回简单的代码指标（行数、函数数、TODO 数量）
3. **生成建议**：Agent 根据文件内容和分析结果，给出 3-5 条改进建议
4. **交互式 CLI**：用户可以输入文件路径，Agent 输出审查报告

### 示例交互

```
============================================
  🔍 Code Review Agent
============================================
> review ./src/utils.ts
🤖 正在读取文件...
🔧 执行工具: read_file({"path":"./src/utils.ts"})
📋 文件内容已读取 (156 行)
🔧 执行工具: analyze_code({"content":"..."})
📋 分析结果: 8 个函数, 3 个 TODO, 0 个测试
🤖 审查报告：
   1. 函数过长：formatDate 有 45 行，建议拆分为更小的函数
   2. 缺少测试：8 个函数但没有对应的单元测试
   3. TODO 未处理：3 个 TODO 注释需要跟进
   4. 类型安全：有 2 处使用了 any，建议添加具体类型
   5. 命名规范：变量 x、y、z 语义不明确

> review ./src/main.ts
...

> /quit
👋 Goodbye!
```

### 起始代码

基于 `examples/06-mini-agent-cli/index.ts`，修改工具定义和系统提示：

```ts
const SYSTEM_PROMPT = `你是一个代码审查助手。你的任务是：
1. 读取用户指定的文件
2. 分析代码质量
3. 给出 3-5 条具体的改进建议

建议应该具体、可操作，不要泛泛而谈。`
```

### 提示

<details>
<summary>💡 提示 1：文件读取安全</summary>

`read_file` 工具应该限制可访问的路径，防止读取敏感文件（如 `~/.ssh/id_rsa`）。可以限制为当前目录下的 `.ts`、`.js`、`.json` 文件。

</details>

<details>
<summary>💡 提示 2：analyze_code 的实现</summary>

不需要真正的 AST 解析，用正则表达式即可：

```ts
const functions = (content.match(/function\s+\w+/g) || []).length
const todos = (content.match(/TODO|FIXME/gi) || []).length
const anys = (content.match(/:\s*any\b/g) || []).length
```

</details>

<details>
<summary>💡 提示 3：输出格式化</summary>

让 LLM 输出 Markdown 格式的报告，在终端中显示更美观。或者在 `execute` 后处理结果，生成统一的报告格式。

</details>

### 解答

<details>
<summary>✅ 点击查看完整实现</summary>

```ts
import { Type } from '@sinclair/typebox'
import type { AgentTool } from '@earendil-works/pi-agent-core'
import * as fs from 'fs'
import * as path from 'path'

// ============ 工具定义 ============

const readFileTool: AgentTool = {
  name: 'read_file',
  label: '读取文件',
  description: '读取指定路径的代码文件内容',
  parameters: Type.Object({
    path: Type.String({ description: '文件路径，相对于当前目录' }),
  }),
  execute: async (id, params) => {
    const targetPath = path.resolve(params.path)
    const cwd = process.cwd()

    // 安全检查：只能读取当前目录下的文件
    if (!targetPath.startsWith(cwd)) {
      throw new Error('只能读取当前工作目录下的文件')
    }

    // 安全检查：只允许代码文件
    const allowedExts = ['.ts', '.js', '.tsx', '.jsx', '.json', '.md']
    const ext = path.extname(targetPath)
    if (!allowedExts.includes(ext)) {
      throw new Error(`不支持的文件类型: ${ext}，只允许: ${allowedExts.join(', ')}`)
    }

    if (!fs.existsSync(targetPath)) {
      throw new Error(`文件不存在: ${params.path}`)
    }

    const content = fs.readFileSync(targetPath, 'utf-8')
    return {
      content: [{ type: 'text', text: content }],
      details: { path: targetPath, size: content.length },
    }
  },
}

const analyzeCodeTool: AgentTool = {
  name: 'analyze_code',
  label: '分析代码',
  description: '分析代码质量指标',
  parameters: Type.Object({
    content: Type.String({ description: '代码内容' }),
  }),
  execute: async (id, params) => {
    const lines = params.content.split('\n')
    const functions = (params.content.match(/function\s+\w+|const\s+\w+\s*=\s*\(.*\)\s*=>/g) || []).length
    const todos = (params.content.match(/TODO|FIXME/gi) || []).length
    const anys = (params.content.match(/:\s*any\b/g) || []).length
    const classes = (params.content.match(/class\s+\w+/g) || []).length
    const imports = (params.content.match(/import\s+.*?from\s+['"]/g) || []).length

    const report = [
      `总行数: ${lines.length}`,
      `函数/箭头函数: ${functions}`,
      `类定义: ${classes}`,
      `导入语句: ${imports}`,
      `TODO/FIXME: ${todos}`,
      `any 类型: ${anys}`,
    ].join('\n')

    return {
      content: [{ type: 'text', text: report }],
      details: { lines: lines.length, functions, todos, anys },
    }
  },
}

// ============ Agent 配置 ============

const SYSTEM_PROMPT = `你是一个专业的代码审查助手。你的工作流程：
1. 使用 read_file 读取用户指定的文件
2. 使用 analyze_code 分析代码质量
3. 根据分析结果，给出 3-5 条具体、可操作的改进建议

建议格式：
- 问题描述（具体位置或函数名）
- 为什么这是个问题
- 如何修复（给出代码示例或具体步骤）

保持专业但友好的语气。如果代码质量很好，也要给予肯定。`
```

**将以上工具加入 Agent 的 `tools` 数组，并设置 `SYSTEM_PROMPT` 即可。**

</details>

### 扩展挑战

完成基础版本后，尝试以下扩展：

1. **多文件审查**：支持 `review src/*.ts` 批量审查多个文件
2. **对比模式**：支持 `diff file1.ts file2.ts` 审查变更
3. **规则配置**：从 `.reviewrc.json` 读取自定义审查规则
4. **输出报告**：将审查结果写入 `review-report.md`

---

> 🎉 恭喜完成所有练习！如果你顺利做到了这里，你已经具备了独立构建 Agent 应用的能力。下一步：[项目篇](/project/01-overview) 或 [生产检查清单](/project/10-production-checklist)。

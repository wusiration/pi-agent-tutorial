# 09 接入真实 LLM 提供商

> 教学项目默认使用 OpenAI 兼容接口，但实际场景中你可能需要接入 DeepSeek、Claude、Gemini 或其他自托管模型。本章教你如何添加一个新的 LLM 提供商。

## 目标

为 playground 添加对 **DeepSeek** 的支持（其他提供商同理），实现：
1. 实现 `LLMProvider` 接口
2. 添加配置（API key、base URL、model）
3. 在提供商工厂中注册
4. 验证新提供商可用

---

## 第一步：理解 LLMProvider 接口

在 `pi-ai` 包中，所有 LLM 提供商都遵循统一的接口：

```ts
// playground/shared/types.ts（或 pi-ai 包中的定义）
interface LLMProvider {
  /** 提供商唯一标识 */
  id: string

  /** 支持的模型列表 */
  listModels(): Promise<string[]>

  /** 简单对话（非流式） */
  chat(options: ChatOptions): Promise<ChatResponse>

  /** 流式对话 */
  stream(options: ChatOptions): AsyncGenerator<StreamEvent, void, unknown>
}

interface ChatOptions {
  model: string
  messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>
  temperature?: number
  maxTokens?: number
  tools?: ToolDefinition[]
}

type StreamEvent =
  | { type: 'text_delta'; delta: string }
  | { type: 'tool_call'; toolCall: ToolCall }
  | { type: 'done' }
  | { type: 'error'; error: Error }
```

**关键设计**：接口只关心"输入消息、输出事件"，不关心底层是 OpenAI、Claude 还是本地模型。

---

## 第二步：实现 DeepSeek 提供商

### 2.1 创建 provider 文件

```ts
// playground/backend/src/llm/providers/deepseek.ts
import type { LLMProvider, ChatOptions, StreamEvent } from '../../../shared/types'

export interface DeepSeekConfig {
  apiKey: string
  baseUrl?: string
  defaultModel?: string
}

export class DeepSeekProvider implements LLMProvider {
  id = 'deepseek'
  private config: DeepSeekConfig

  constructor(config: DeepSeekConfig) {
    this.config = {
      baseUrl: 'https://api.deepseek.com/v1',
      defaultModel: 'deepseek-chat',
      ...config,
    }
  }

  async listModels(): Promise<string[]> {
    // DeepSeek 目前主要模型
    return ['deepseek-chat', 'deepseek-coder']
  }

  async chat(options: ChatOptions) {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || this.config.defaultModel,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
        tools: options.tools,
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`DeepSeek API error: ${response.status} ${error}`)
    }

    const data = await response.json()
    return {
      content: data.choices[0].message.content,
      toolCalls: data.choices[0].message.tool_calls,
    }
  }

  async *stream(options: ChatOptions): AsyncGenerator<StreamEvent, void, unknown> {
    const response = await fetch(`${this.config.baseUrl}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.config.apiKey}`,
      },
      body: JSON.stringify({
        model: options.model || this.config.defaultModel,
        messages: options.messages,
        temperature: options.temperature ?? 0.7,
        max_tokens: options.maxTokens,
        tools: options.tools,
        stream: true, // ← 关键：启用流式输出
      }),
    })

    if (!response.ok) {
      const error = await response.text()
      throw new Error(`DeepSeek API error: ${response.status} ${error}`)
    }

    const reader = response.body!.getReader()
    const decoder = new TextDecoder()
    let buffer = ''

    try {
      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          const trimmed = line.trim()
          if (!trimmed || trimmed === 'data: [DONE]') continue
          if (!trimmed.startsWith('data: ')) continue

          const jsonStr = trimmed.slice(6)
          let json: any
          try {
            json = JSON.parse(jsonStr)
          } catch {
            continue
          }

          const delta = json.choices?.[0]?.delta
          if (!delta) continue

          // 文本增量
          if (delta.content) {
            yield { type: 'text_delta', delta: delta.content }
          }

          // 工具调用增量（部分提供商在流中返回 tool_calls）
          if (delta.tool_calls) {
            for (const tc of delta.tool_calls) {
              yield {
                type: 'tool_call',
                toolCall: {
                  id: tc.id || `call_${Date.now()}`,
                  name: tc.function?.name || '',
                  arguments: tc.function?.arguments || '',
                },
              }
            }
          }
        }
      }

      yield { type: 'done' }
    } catch (error) {
      yield { type: 'error', error: error as Error }
    } finally {
      reader.releaseLock()
    }
  }
}
```

### 2.2 关键注意事项

| 注意点 | 说明 |
|--------|------|
| SSE 解析 | 流式响应是 `text/event-stream` 格式，需要按行解析 `data: {...}` |
| 增量合并 | `delta.tool_calls` 可能在多个 chunk 中分段返回，需要累积合并 |
| 错误处理 | 网络错误、API 限流、模型不可用都需要转换为统一的 `error` 事件 |
| 释放资源 | `reader.releaseLock()` 确保连接被关闭，避免内存泄漏 |

---

## 第三步：在工厂中注册

### 3.1 修改 provider 工厂

```ts
// playground/backend/src/llm/provider-factory.ts
import { OpenAIProvider } from './providers/openai'
import { DeepSeekProvider } from './providers/deepseek'
import type { LLMProvider } from '../../shared/types'

export function createProvider(
  providerId: string,
  config: Record<string, string>,
): LLMProvider {
  switch (providerId) {
    case 'openai':
      return new OpenAIProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
      })

    case 'deepseek':
      return new DeepSeekProvider({
        apiKey: config.apiKey,
        baseUrl: config.baseUrl,
        defaultModel: config.model,
      })

    default:
      throw new Error(`Unknown provider: ${providerId}`)
  }
}

export function listSupportedProviders(): string[] {
  return ['openai', 'deepseek']
}
```

### 3.2 从环境变量读取配置

```ts
// playground/backend/src/config.ts
export const llmConfig = {
  provider: process.env.LLM_PROVIDER || 'openai',
  apiKey: process.env.LLM_API_KEY || '',
  baseUrl: process.env.LLM_BASE_URL,
  model: process.env.LLM_MODEL,
}
```

---

## 第四步：前端配置界面

让用户可以在前端切换提供商：

```ts
// playground/frontend/src/components/ProviderSelector.tsx
export function ProviderSelector() {
  const [provider, setProvider] = useState('openai')
  const [model, setModel] = useState('')

  const providers = [
    { id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini'] },
    { id: 'deepseek', name: 'DeepSeek', models: ['deepseek-chat', 'deepseek-coder'] },
  ]

  return (
    <div className="provider-selector">
      <select value={provider} onChange={(e) => setProvider(e.target.value)}>
        {providers.map((p) => (
          <option key={p.id} value={p.id}>{p.name}</option>
        ))}
      </select>
      <select value={model} onChange={(e) => setModel(e.target.value)}>
        {providers.find((p) => p.id === provider)?.models.map((m) => (
          <option key={m} value={m}>{m}</option>
        ))}
      </select>
    </div>
  )
}
```

---

## 第五步：测试新提供商

### 5.1 单元测试

```ts
// playground/backend/src/llm/providers/deepseek.test.ts
import { describe, it, expect, vi } from 'vitest'
import { DeepSeekProvider } from './deepseek'

describe('DeepSeekProvider', () => {
  it('should list supported models', async () => {
    const provider = new DeepSeekProvider({ apiKey: 'test' })
    const models = await provider.listModels()
    expect(models).toContain('deepseek-chat')
    expect(models).toContain('deepseek-coder')
  })

  it('should use custom baseUrl', () => {
    const provider = new DeepSeekProvider({
      apiKey: 'test',
      baseUrl: 'https://custom.deepseek.com',
    })
    expect(provider['config'].baseUrl).toBe('https://custom.deepseek.com')
  })
})
```

### 5.2 集成测试

```bash
# 设置环境变量
export LLM_PROVIDER=deepseek
export LLM_API_KEY=sk-...
export LLM_MODEL=deepseek-chat

# 启动后端
cd playground/backend
npm run dev

# 在前端切换提供商为 DeepSeek，发送一条测试消息
```

### 5.3 验证清单

- [ ] `listModels()` 返回正确的模型列表
- [ ] `chat()` 能返回完整回复
- [ ] `stream()` 能逐字输出
- [ ] 工具调用能正常触发
- [ ] API 错误能正确转换为 `error` 事件
- [ ] 切换提供商后，历史会话仍能正常显示（注意：不同提供商的 token 计算可能不同）

---

## 常见提供商接入要点

| 提供商 | 接口格式 | 特殊注意 |
|--------|---------|---------|
| **OpenAI** | 标准 | 基准实现，其他提供商通常兼容此格式 |
| **DeepSeek** | OpenAI 兼容 | 流式响应格式完全一致 |
| **Claude (Anthropic)** | 自定义 | 消息格式为 `{role, content}` 数组，tool 格式不同 |
| **Gemini (Google)** | 自定义 | 使用 `generateContent` API，流式为 server-side events |
| **Ollama (本地)** | OpenAI 兼容 | baseUrl 指向 `http://localhost:11434/v1` |
| **Azure OpenAI** | OpenAI 兼容 | 需要 `api-version` 参数，URL 结构不同 |

### Claude 的差异示例

```ts
// Claude 的消息格式
const claudeMessages = options.messages.map((m) => ({
  role: m.role === 'system' ? 'user' : m.role, // Claude 没有 system role
  content: m.content,
}))

// Claude 的工具格式
const claudeTools = options.tools?.map((t) => ({
  name: t.name,
  description: t.description,
  input_schema: t.parameters, // 注意：不是 parameters
}))
```

---

## 下一步

- 接入更多提供商？参考 [pi-ai 层的四种协议](/guide/09-pi-ai-layer)
- 准备上线？阅读 [10 生产检查清单](10-production-checklist)

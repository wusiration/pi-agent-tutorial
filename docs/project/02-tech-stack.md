# 02 技术选型与目录结构

> 这一章我们初始化项目，配置 TypeScript、Vite、Tailwind 和 Fastify。所有配置都经过精简，只保留必要的部分。

## 初始化目录

```bash
mkdir -p pi-agent-playground/{backend/src/{core,llm,session,api},frontend/src/{components,hooks,types},shared}
cd pi-agent-playground
```

## 后端初始化

```bash
cd backend
npm init -y
npm install fastify @fastify/cors @fastify/sensible
npm install -D typescript tsx @types/node
npx tsc --init
```

### backend/tsconfig.json

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "NodeNext",
    "moduleResolution": "NodeNext",
    "esModuleInterop": true,
    "strict": true,
    "skipLibCheck": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "resolveJsonModule": true,
    "declaration": true,
    "declarationMap": true,
    "sourceMap": true
  },
  "include": ["src/**/*", "../shared/**/*"]
}
```

### backend/package.json

```json
{
  "name": "pi-agent-backend",
  "version": "1.0.0",
  "type": "module",
  "scripts": {
    "dev": "tsx watch src/index.ts",
    "build": "tsc",
    "start": "node dist/index.js"
  }
}
```

## 前端初始化

```bash
cd ../frontend
npm create vite@latest . -- --template react-ts
npm install
npm install -D tailwindcss postcss autoprefixer
npx tailwindcss init -p
```

### frontend/tailwind.config.js

```js
/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {},
  },
  plugins: [],
}
```

### frontend/src/index.css

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

body {
  @apply bg-gray-50 text-gray-900;
}
```

### frontend/vite.config.ts

```ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3000',
        changeOrigin: true,
      },
    },
  },
})
```

## 共享类型

```bash
cd ../shared
# 不需要 package.json，直接用相对路径引用
```

### shared/types.ts

```ts
// 前后端共享的核心类型

export interface UserMessage {
  role: 'user'
  content: string
  timestamp: number
}

export interface AssistantMessage {
  role: 'assistant'
  content: Array<{ type: 'text'; text: string } | { type: 'toolCall'; id: string; name: string; arguments: Record<string, any> }>
  stopReason: 'stop' | 'length' | 'toolUse' | 'error'
  timestamp: number
}

export interface ToolResultMessage {
  role: 'toolResult'
  toolCallId: string
  toolName: string
  content: Array<{ type: 'text'; text: string }>
  isError: boolean
  timestamp: number
}

export type Message = UserMessage | AssistantMessage | ToolResultMessage

export interface ToolDefinition {
  name: string
  label: string
  description: string
  parameters: Record<string, any> // JSON Schema
}

export interface ToolResult {
  content: Array<{ type: 'text'; text: string }>
  details?: Record<string, any>
  terminate?: boolean
}

export type AgentEvent =
  | { type: 'agent_start' }
  | { type: 'agent_end'; messages: Message[] }
  | { type: 'turn_start' }
  | { type: 'turn_end'; message: Message; toolResults: ToolResultMessage[] }
  | { type: 'message_start'; message: Message }
  | { type: 'message_update'; message: Message; delta: string }
  | { type: 'message_end'; message: Message }
  | { type: 'tool_execution_start'; toolCallId: string; toolName: string; args: any }
  | { type: 'tool_execution_update'; toolCallId: string; partialResult: ToolResult }
  | { type: 'tool_execution_end'; toolCallId: string; toolName: string; result: ToolResult; isError: boolean }

export interface ChatRequest {
  message: string
  sessionId?: string
  useMock?: boolean
}

export interface ChatResponse {
  event: AgentEvent
}
```

## 目录树

```
pi-agent-playground/
├── backend/
│   ├── src/
│   │   ├── core/
│   │   │   ├── types.ts
│   │   │   ├── agent-loop.ts
│   │   │   ├── agent.ts
│   │   │   └── tool-registry.ts
│   │   ├── llm/
│   │   │   ├── openai-client.ts
│   │   │   └── mock-client.ts
│   │   ├── session/
│   │   │   ├── session-manager.ts
│   │   │   └── compaction.ts
│   │   ├── api/
│   │   │   ├── server.ts
│   │   │   ├── routes.ts
│   │   │   └── sse.ts
│   │   └── index.ts
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Chat.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── ToolCard.tsx
│   │   │   └── TypingIndicator.tsx
│   │   ├── hooks/
│   │   │   ├── useAgent.ts
│   │   │   └── useEventSource.ts
│   │   ├── types/
│   │   │   └── events.ts
│   │   ├── App.tsx
│   │   ├── main.tsx
│   │   └── index.css
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
└── shared/
    └── types.ts
```

## 本章小结

- 后端用 Fastify + TypeScript，前端用 React + Vite + Tailwind。
- 共享类型放在 `shared/types.ts`，前后端通过相对路径引用。
- 前端开发服务器代理 `/api` 到后端，避免 CORS 问题。

## 验证

```bash
# 后端
cd backend
npm run dev
# 应该看到: Server listening at http://localhost:3000

# 前端（新终端）
cd frontend
npm run dev
# 应该看到: http://localhost:5173
```

如果两个服务都成功启动，说明环境配置正确。下一章开始写核心代码。

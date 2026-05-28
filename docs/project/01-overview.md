# 01 项目概述

> 从这一章开始，我们将把前面学到的原理和 Demo 组合起来，实现一个**教学版 Pi Agent**。它不是生产系统，但保留了 Pi 的核心设计思想，并且可以直接运行。

## 我们要做什么？

一个基于 Web 的 AI Agent 应用：

```mermaid
graph LR
    A[用户浏览器] -->|HTTP / SSE| B[Node.js 后端]
    B -->|streamSimple| C[LLM API]
    B -->|execute| D[工具实现]
    D -->|结果| B
    B -->|SSE 事件流| A
```

**功能清单**：

- [x] 流式对话（逐字显示 AI 回复）
- [x] 工具调用（天气查询、计算器、搜索）
- [x] 工具执行可视化（显示执行中/成功/失败状态）
- [x] 多轮对话历史
- [x] 会话管理（新建、重置、导出）
- [x] Mock LLM 模式（无需 API key 即可演示）
- [x] 上下文压缩（简化版）

**不做的功能**（保持教学聚焦）：

- [ ] 多提供商支持（只保留 OpenAI 兼容协议）
- [ ] 终端 UI（用 Web 替代）
- [ ] 文件系统工具（避免安全风险）
- [ ] 扩展系统
- [ ] 用户认证

## 技术栈

| 层级 | 技术 | 理由 |
|------|------|------|
| 前端 | React 18 + TypeScript | 组件化、类型安全、生态成熟 |
| 前端构建 | Vite | 快、配置简单 |
| 前端样式 | Tailwind CSS | 原子化、不离开 HTML 写样式 |
| 后端 | Node.js + Fastify | 比 Express 更快、类型友好 |
| 后端流式 | SSE (Server-Sent Events) | 比 WebSocket 简单，适合单向推送 |
| 类型共享 | 前后端共用 `types.ts` | 避免重复定义、保证一致 |

## 项目结构

```
playground/
├── backend/
│   ├── src/
│   │   ├── core/
│   │   │   ├── types.ts           # 核心类型（与 pi-agent-core 对应）
│   │   │   ├── agent-loop.ts      # Agent Loop 实现
│   │   │   ├── agent.ts           # Agent 类
│   │   │   └── tool-registry.ts   # 工具注册表
│   │   ├── llm/
│   │   │   ├── openai-client.ts   # OpenAI 兼容客户端
│   │   │   └── mock-client.ts     # Mock 客户端
│   │   ├── session/
│   │   │   ├── session-manager.ts # 简化版会话管理
│   │   │   └── compaction.ts      # 简化版压缩
│   │   ├── api/
│   │   │   ├── server.ts          # Fastify 服务器
│   │   │   ├── routes.ts          # HTTP 路由
│   │   │   └── sse.ts             # SSE 流处理
│   │   └── index.ts               # 入口
│   ├── package.json
│   └── tsconfig.json
│
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
│   │   └── main.tsx
│   ├── index.html
│   ├── package.json
│   ├── vite.config.ts
│   └── tailwind.config.js
│
└── shared/
    └── types.ts                    # 前后端共享类型
```

## 与 Pi 原版的对应关系

| 教学版文件 | Pi 原版文件 | 简化点 |
|-----------|-----------|--------|
| `backend/src/core/agent-loop.ts` | `pi-agent-core/src/agent-loop.ts` | 去掉 transport、getApiKey 等高级功能 |
| `backend/src/core/agent.ts` | `pi-agent-core/src/agent.ts` | 简化错误重试逻辑 |
| `backend/src/llm/openai-client.ts` | `pi-ai/src/stream.ts` | 只支持 OpenAI 协议 |
| `backend/src/session/session-manager.ts` | `pi-coding-agent/src/core/session-manager.ts` | 内存存储，可选 JSON 导出 |
| `backend/src/session/compaction.ts` | `pi-coding-agent/src/core/compaction/compaction.ts` | 简化触发条件和摘要生成 |

## 运行效果预览

```
┌─────────────────────────────────────────┐
│  Pi Agent 教学版                        │
├─────────────────────────────────────────┤
│                                         │
│  You: 北京天气怎么样？                  │
│  🤖 我来查一下...                       │
│  🔧 weather 执行中...                   │
│  ✅ weather 完成                        │
│  🤖 北京今天 18°C，小雨                 │
│                                         │
│  [输入框...] [发送]                     │
└─────────────────────────────────────────┘
```

## 开发计划

1. [02 技术选型与目录结构](/project/02-tech-stack) — 初始化项目
2. [03 后端：Agent Core](/project/03-backend-core) — 实现 Agent Loop 和工具系统
3. [04 后端：HTTP API 与 SSE](/project/04-backend-api) — 暴露 REST 和流式接口
4. [05 前端：React 聊天界面](/project/05-frontend-chat) — 实现消息显示和输入
5. [06 前端：工具执行可视化](/project/06-frontend-tools) — 显示工具状态
6. [07 联调与运行](/project/07-integration) — 跑通全流程
7. [08 扩展方向](/project/08-extensions) — 你可以继续做什么

## 本章小结

- 教学版项目是一个**全栈 Web 应用**，保留 Pi 核心思想，简化外围功能。
- 技术栈选择以**易读、易运行、易扩展**为优先。
- 每一章都会提供可直接运行的代码，确保你能跟着一步步做出来。

## 准备工作

在开始之前，请确保你的环境满足：
- Node.js >= 18
- npm >= 9
- 一个 OpenAI API key（或使用 Mock 模式）

```bash
node -v  # >= 18
npm -v   # >= 9
```

# 教学版项目

> 把前面学到的原理和 Demo 组合起来，实现一个**可运行的全栈 Agent 应用**。这不是生产系统，但保留了 Pi 的核心设计思想。

## 项目概述

- **前端**：React + TypeScript + Tailwind CSS + Vite
- **后端**：Node.js + Fastify + SSE
- **核心机制**：Agent Loop、工具系统、事件流、会话管理

## 章节导航

1. [01 项目概述](01-overview) — 功能清单、技术栈、运行效果
2. [02 技术选型与目录结构](02-tech-stack) — 初始化项目、配置 TypeScript / Vite / Fastify
3. [03 后端：Agent Core](03-backend-core) — 类型、工具注册表、Mock/真实 LLM、Agent Loop、Agent 类
4. [04 后端：HTTP API 与 SSE](04-backend-api) — Fastify 路由、SSE 流、会话管理
5. [05 前端：React 聊天界面](05-frontend-chat) — useAgent hook、MessageBubble、TypingIndicator
6. [06 前端：工具执行可视化](06-frontend-tools) — ToolCard、会话管理、导出功能
7. [07 联调与运行](07-integration) — 完整启动流程、问题排查、部署指南
8. [08 扩展方向](08-extensions) — 多提供商、RAG、多 Agent、持久化、沙箱、测试

## 快速开始

```bash
# 1. 进入项目目录
cd pi-agent-playground

# 2. 启动后端
cd backend
npm install
npm run dev

# 3. 启动前端（新终端）
cd ../frontend
npm install
npm run dev

# 4. 打开浏览器
open http://localhost:5173
```

## 功能演示

```
┌─────────────────────────────────────────┐
│  Pi Agent 教学版        [Mock ☑] [新会话]│
├─────────────────────────────────────────┤
│                                         │
│  You: 北京天气怎么样？                  │
│                                         │
│  🤖 我来查一下北京的天气...              │
│  ⏳ weather 执行中... 已执行 1 秒       │
│  ✅ weather 已完成                      │
│     北京当前天气：小雨，18°C            │
│  🤖 北京今天小雨，气温 18°C             │
│                                         │
│  [________________] [发送]              │
└─────────────────────────────────────────┘
```

## 与 Pi 原版的对比

| 功能 | Pi 原版 | 教学版 |
|------|--------|--------|
| 运行模式 | TUI / Print / RPC / SDK | Web 应用 |
| LLM 提供商 | 30+ | OpenAI 兼容（可扩展） |
| 持久化 | JSONL 文件 | 内存 + 可选导出 |
| 工具 | read/write/edit/bash | weather/calculator/search |
| 扩展系统 | 完整 | 暂不实现 |
| 上下文压缩 | 自动 + 手动 | 简化版 |

教学版的目标是**理解原理**，而非替代 Pi。当你掌握了这些核心机制，阅读 Pi 源码会事半功倍。

# Pi Agent 原理与实现：从零到一实现一个 AI Agent

> 基于 [earendil-works/pi](https://github.com/earendil-works/pi) 的渐进式中文教程，包含原理讲解、源码拆解、渐进式 Demo 和完整教学项目。

---

## 📖 这是什么？

这是一个面向计算机本科毕业生和初中级工程师的**手把手教学项目**。它不是简单的源码解读，而是把 [Pi Agent](https://pi.dev) 拆解成一套渐进式教程，让读者可以从零开始：

1. **先理解核心概念** — Agent 为什么需要状态、事件、工具与循环
2. **再通过 Demo 练手** — 文档中包含 7 个渐进式 Demo 讲解，`examples/00-06` 均已提供独立可运行版本
3. **最后实现完整项目** — React 前端 + Node.js 后端，保留 Pi 的核心思想

整体风格像一个有实战经验的工程师在带徒弟，讲清楚"为什么这么设计""每一步在解决什么问题"，拒绝论文腔和只贴源码。

---

## 🗂️ 项目结构

```
pi-agent-tutorial/
├── docs/                          # VitePress 教程站点（本仓库核心）
│   ├── .vitepress/
│   │   └── config.mts             # VitePress 站点配置
│   ├── guide/                     # 📚 原理篇（11 章）
│   ├── demos/                     # 🛠️ Demo 篇（5 个）
│   ├── project/                   # 🚀 项目篇（8 章）
│   └── public/
│       └── logo.svg               # 站点 Logo
│
├── examples/                      # 最小可运行示例（独立目录，直接运行）
│   ├── 00-hello-llm/              # 原始 LLM 流式输出（无需 API Key）
│   ├── 01-manual-loop/            # 最小 Agent Loop（无框架依赖）
│   ├── 02-tool-calls/             # 工具调用与并行执行
│   ├── 03-event-stream/           # 事件驱动架构
│   ├── 04-session-context/        # 会话管理与上下文修剪
│   ├── 05-steering-abort/         # Steering 与协作式取消
│   └── 06-mini-agent-cli/         # 全功能交互式 CLI（无需 API Key）
│
├── playground/                    # 完整全栈项目（前后端分离）
│   ├── backend/                   # Node.js + Fastify + SSE
│   │   ├── src/
│   │   ├── package.json
│   │   └── tsconfig.json
│   ├── frontend/                  # React + Tailwind + Vite
│   │   ├── src/
│   │   ├── package.json
│   │   └── vite.config.ts
│   └── shared/                    # 前后端共享类型
│       └── types.ts
│
├── package.json                   # 文档站点依赖
├── README.md                      # 本文件
├── CONTRIBUTING.md                # 贡献指南
├── CHANGELOG.md                   # 版本记录
└── DEPLOY.md                      # 部署文档
```

**三个层次的关系**：

| 层次 | 内容 | 用途 |
|------|------|------|
| `docs/` | VitePress 教程站点 | 阅读学习，理解原理 |
| `examples/` | 最小可运行代码 | 快速验证一个机制，无框架依赖 |
| `playground/` | 完整全栈项目 | 端到端运行，理解工程实践 |

---

## 🚀 快速开始

### 1. 阅读教程（docs/）

```bash
npm install
npm run docs:dev
# 打开 http://localhost:5173
```

### 2. 运行最小示例（examples/）

```bash
# 任意一个示例都可以独立运行
cd examples/00-hello-llm   # 或 01-06 中的任意一个
npm install
npm start
# 00 和 06 无需 API key，使用 Mock LLM
```

### 3. 运行完整项目（playground/）

```bash
# 终端 1：启动后端
cd playground/backend
npm install
npm run dev

# 终端 2：启动前端
cd playground/frontend
npm install
npm run dev

# 打开 http://localhost:5173
```

---

## 📚 教程内容导航

### 三条学习路径

#### 🌱 入门路径（2-3 小时）

理解 Agent 为什么存在，掌握基础循环。

```
examples/00-hello-llm → 01-manual-loop → 02-tool-calls
```

#### 🌿 进阶路径（4-6 小时）

理解完整架构，把 Demo 组合成可交互应用。

```
examples/03-event-stream → 04-session-context → 05-steering-abort
        ↓
examples/06-mini-agent-cli
        ↓
playground/（完整全栈项目）
```

#### 🌳 高阶路径（按需）

生产就绪：扩展、部署、运维。

```
docs/guide/（全部 11 章原理）
        ↓
扩展 playground：新 LLM 提供商 / 自定义工具
        ↓
docs/project/09-real-llm-provider
        ↓
docs/project/10-production-checklist
        ↓
部署上线
```

### 内容分布

| 篇章 | 章节数 | 核心内容 |
|------|--------|---------|
| **原理篇** `docs/guide/` | 11 章 | 从"为什么需要 Agent"到 LLM 抽象层 |
| **Demo 篇** `docs/demos/` | 7 个 | Hello LLM → 流式输出 → 手动 Loop → 工具 → UI → Steering → Mini CLI |
| **项目篇** `docs/project/` | 10 章 | 全栈实现：后端 Core → API → 前端聊天 → 联调 → 真实提供商 → 生产清单 |

---

## 🛠️ 技术栈

| 层级 | 技术 | 版本 | 用途 |
|------|------|------|------|
| 文档站点 | VitePress | ^1.6 | 静态站点生成 |
| 文档框架 | Vue 3 | ^3.5 | VitePress 底层框架 |
| 教学项目前端 | React | ^18 | UI 框架 |
| 教学项目前端 | TypeScript | ^5 | 类型系统 |
| 教学项目前端 | Tailwind CSS | ^3 | 原子化样式 |
| 教学项目前端 | Vite | ^5 | 构建工具 |
| 教学项目后端 | Node.js | >=18 | 运行时 |
| 教学项目后端 | Fastify | ^4 | Web 框架 |
| 教学项目后端 | SSE | - | 服务器推送 |
| 参数校验 | TypeBox | ^0.32 | JSON Schema + TS 类型 |
| 测试 | Vitest | ^1.6 | 单元测试 |

---

## 🎯 适合谁读？

- **计算机本科毕业生** — 想深入理解 AI Agent 的工程实现
- **前端/后端开发者** — 希望从"调 API"进阶到"搭系统"
- **技术爱好者** — 对 Pi、earendil-works/pi 感兴趣，想知其然更知其所以然

**前置知识**：
- 熟悉 TypeScript/JavaScript
- 了解基本的 HTTP 和异步编程
- 有 React 基础（项目篇需要）
- 了解 LLM 的基本概念（Prompt、Token 等）

---

## 📦 相关资源

- **Pi 官方仓库**: https://github.com/earendil-works/pi
- **Pi 官方文档**: https://pi.dev/docs/latest
- **Pi npm 包**: https://www.npmjs.com/package/@earendil-works/pi-agent-core
- **VitePress 文档**: https://vitepress.dev

---

## 📄 其他文档

- [CONTRIBUTING.md](./CONTRIBUTING.md) — 如何参与贡献
- [CHANGELOG.md](./CHANGELOG.md) — 版本变更记录
- [DEPLOY.md](./DEPLOY.md) — 部署到 GitHub Pages/Vercel 等平台的指南

---

## 📜 许可证

MIT License

---

> 💡 **提示**：如果你发现任何错误或有改进建议，欢迎提交 Issue 或 PR。详见 [CONTRIBUTING.md](./CONTRIBUTING.md)。

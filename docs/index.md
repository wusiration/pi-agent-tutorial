---
layout: home

hero:
  name: "Pi Agent"
  text: "原理与实现"
  tagline: 从零到一实现一个 AI Agent —— 基于 Pi 的渐进式教程
  image:
    src: /logo.svg
    alt: Pi Agent Logo
  actions:
    - theme: brand
      text: 开始阅读
      link: /guide/01-why-agent
    - theme: alt
      text: 查看 Demo
      link: /demos/01-hello-stream
    - theme: alt
      text: GitHub
      link: https://github.com/earendil-works/pi

features:
  - icon: 🧠
    title: 原理先行
    details: 从核心概念出发，理解 Agent 为什么需要状态、事件、工具与循环，而不是简单地把 LLM 包一层。
  - icon: 🛠️
    title: 渐进式 Demo
    details: 5 个由浅入深的独立 Demo，从流式输出到 Steering 队列，每一步都可运行、可验证。
  - icon: 🚀
    title: 完整项目
    details: 手把手带你实现一个教学版 Pi Agent：React 前端 + Node.js 后端，保留核心思想，去除生产噪音。
  - icon: 📚
    title: 工程师视角
    details: 讲清楚“为什么这么设计”“每一步在解决什么问题”，拒绝论文腔和源码复读。
---

## 适合谁读？

- 计算机本科毕业生，想深入理解 AI Agent 的工程实现
- 前端/后端开发者，希望从“调 API”进阶到“搭系统”
- 对 Pi、earendil-works/pi 感兴趣，想知其然更知其所以然

## 你能学到什么？

1. **Agent 的本质**：不是更复杂的 Prompt，而是“思考 → 行动 → 观察 → 再思考”的闭环
2. **事件驱动**：如何用一套事件协议把 LLM 流、工具执行、UI 更新串起来
3. **工具系统**：Schema 校验、并行执行、前后置钩子、错误自纠正
4. **会话管理**：树形历史、分支导航、上下文压缩（Compaction）
5. **全栈实现**：从 `agentLoop` 到 SSE 再到 React 组件的端到端链路

## 快速开始

```bash
git clone <your-repo>
cd pi-agent-tutorial
npm install
npm run docs:dev
```

然后打开 http://localhost:5173 开始阅读。

# 教程目录

欢迎阅读 **Pi Agent 原理与实现** 教程。这里是你从零开始理解并构建 AI Agent 的完整路径。

## 启程

1. [01 为什么需要 Agent？](01-why-agent) — 从直接调 API 的局限讲起
2. [02 认识 Pi Agent](02-intro-pi) — Pi 的设计哲学与四大模式
3. [03 核心概念速览](03-core-concepts) — AgentMessage、Loop、工具、事件、会话

## 原理拆解

4. [04 消息流与状态机](04-message-flow) — 消息从诞生到被 LLM 消费的完整旅程
5. [05 Agent Loop：思考-行动-观察](05-agent-loop) — 核心循环的每一步
6. [06 事件驱动架构](06-event-architecture) — 如何用事件系统驱动 UI
7. [07 工具系统与并行执行](07-tool-system) — Schema、校验、并发、错误恢复
8. [08 会话树与上下文压缩](08-session-compaction) — 树形历史与智能压缩
9. [09 LLM 抽象层 pi-ai](09-pi-ai-layer) — 四种协议覆盖三十家提供商

## 源码导航

10. [10 代码目录与模块关系](10-code-map) — Monorepo 结构与教学版取舍
11. [11 关键类型与接口](11-types-interfaces) — 核心类型速查表

---

> 💡 **学习建议**：先读完原理篇（01-09），再动手跑 Demo（01-05），最后跟着项目篇实现完整应用。每章末尾都有小练习，强烈建议动手做。

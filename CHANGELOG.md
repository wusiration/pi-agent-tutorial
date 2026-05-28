# 更新日志

所有值得注意的变更都会记录在此文件。

格式基于 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.0.0/)，版本号遵循 [Semantic Versioning](https://semver.org/lang/zh-CN/)。

---

## [1.0.0] - 2026-05-27

### 新增

- **原理篇（Guide）** — 11 章完整原理讲解
  - 01 为什么需要 Agent？— 从直接调 API 的局限引入 Agent 概念
  - 02 认识 Pi Agent — Pi 的设计哲学、四大模式、三大核心特性
  - 03 核心概念速览 — AgentMessage、Loop、Event、Tool、Session 等术语梳理
  - 04 消息流与状态机 — 消息生命周期、transformContext、convertToLlm
  - 05 Agent Loop — 循环内部结构、shouldStopAfterTurn、prepareNextTurn
  - 06 事件驱动架构 — 事件类型、订阅机制、AgentSession 扩展事件
  - 07 工具系统 — Schema 校验、并行执行、before/after hooks、错误处理
  - 08 会话树与压缩 — JSONL 树形结构、Compaction、Branch Summarization
  - 09 LLM 抽象层 — 四种协议、统一事件流、Model 类型、兼容性配置
  - 10 代码目录 — Monorepo 结构、教学版取舍策略
  - 11 关键类型 — 核心接口速查、类型设计亮点

- **Demo 篇（Demos）** — 5 个渐进式独立示例
  - Demo 1: Hello Stream — streamSimple 流式输出
  - Demo 2: 手动 Agent Loop — agentLoop 低层 API 使用
  - Demo 3: 工具调用 — 多工具、并行执行、错误自纠正
  - Demo 4: 事件订阅 UI — 终端聊天界面实现
  - Demo 5: Steering 队列 — 运行时插入指令

- **项目篇（Project）** — 8 章完整全栈实现
  - 01 项目概述 — 功能清单、技术栈、运行效果预览
  - 02 技术选型 — 初始化 TypeScript + Vite + Fastify 项目
  - 03 后端 Core — Agent Loop、Agent 类、Mock/真实 LLM 客户端
  - 04 后端 API — Fastify 路由、SSE 流、会话管理端点
  - 05 前端聊天 — useAgent hook、MessageBubble、TypingIndicator
  - 06 前端工具 — ToolCard、会话管理、导出功能
  - 07 联调运行 — 启动流程、问题排查、部署指南
  - 08 扩展方向 — 多提供商、RAG、多 Agent、持久化等

- **站点基础设施**
  - VitePress 1.6 文档站点
  - 中文搜索支持（local search）
  - Mermaid 图表支持
  - 响应式布局
  - 代码行号显示

- **项目文档**
  - README.md — 项目说明与快速开始
  - CONTRIBUTING.md — 贡献指南
  - DEPLOY.md — 部署文档

---

## [Unreleased]

### 计划中的改进

- [ ] 添加 Dark/Light 模式切换优化
- [ ] 为每章添加"预计阅读时间"
- [ ] 补充更多 Mermaid 架构图
- [ ] 添加视频讲解链接（如有）
- [ ] 补充单元测试示例（项目篇）
- [ ] 添加 Docker Compose 一键启动

---

## 版本说明

| 版本 | 日期 | 说明 |
|------|------|------|
| 1.0.0 | 2026-05-27 | 首个完整版本，包含原理篇、Demo 篇、项目篇全部内容 |

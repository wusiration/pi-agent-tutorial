import { defineConfig } from 'vitepress'
import { withMermaid } from 'vitepress-plugin-mermaid'

export default withMermaid(defineConfig({
  title: 'Pi Agent 原理与实现',
  description: '从零到一实现一个 AI Agent —— 基于 Pi 的渐进式教程',
  lang: 'zh-CN',
  base: '/pi-agent-tutorial/',
  lastUpdated: true,
  cleanUrls: true,
  ignoreDeadLinks: ['http://localhost:5173', 'http://localhost:3000'],

  themeConfig: {
    logo: '/logo.svg',
    nav: [
      { text: '首页', link: '/' },
      { text: '教程', link: '/guide/01-why-agent' },
      { text: 'Demo', link: '/demos/01-hello-stream' },
      { text: '项目实现', link: '/project/01-overview' },
    ],
    sidebar: {
      '/guide/': [
        {
          text: '启程',
          items: [
            { text: '01 为什么需要 Agent？', link: '/guide/01-why-agent' },
            { text: '02 认识 Pi Agent', link: '/guide/02-intro-pi' },
            { text: '03 核心概念速览', link: '/guide/03-core-concepts' },
          ],
        },
        {
          text: '原理拆解',
          items: [
            { text: '04 消息流与状态机', link: '/guide/04-message-flow' },
            { text: '05 Agent Loop：思考-行动-观察', link: '/guide/05-agent-loop' },
            { text: '06 事件驱动架构', link: '/guide/06-event-architecture' },
            { text: '07 工具系统与并行执行', link: '/guide/07-tool-system' },
            { text: '08 会话树与上下文压缩', link: '/guide/08-session-compaction' },
            { text: '09 LLM 抽象层 pi-ai', link: '/guide/09-pi-ai-layer' },
          ],
        },
        {
          text: '源码导航',
          items: [
            { text: '10 代码目录与模块关系', link: '/guide/10-code-map' },
            { text: '11 关键类型与接口', link: '/guide/11-types-interfaces' },
          ],
        },
      ],
      '/demos/': [
        {
          text: '渐进式 Demo',
          items: [
            { text: 'Demo 1：Hello Stream', link: '/demos/01-hello-stream' },
            { text: 'Demo 2：手动 Agent Loop', link: '/demos/02-manual-loop' },
            { text: 'Demo 3：工具调用与执行', link: '/demos/03-tool-calls' },
            { text: 'Demo 4：事件订阅与 UI', link: '/demos/04-event-ui' },
            { text: 'Demo 5：Steering 与队列', link: '/demos/05-steering-queue' },
          ],
        },
      ],
      '/project/': [
        {
          text: '教学版项目',
          items: [
            { text: '01 项目概述', link: '/project/01-overview' },
            { text: '02 技术选型与目录结构', link: '/project/02-tech-stack' },
            { text: '03 后端：Agent Core', link: '/project/03-backend-core' },
            { text: '04 后端：HTTP API 与 SSE', link: '/project/04-backend-api' },
            { text: '05 前端：React 聊天界面', link: '/project/05-frontend-chat' },
            { text: '06 前端：工具执行可视化', link: '/project/06-frontend-tools' },
            { text: '07 联调与运行', link: '/project/07-integration' },
            { text: '08 扩展方向', link: '/project/08-extensions' },
          ],
        },
      ],
    },
    socialLinks: [
      { icon: 'github', link: 'https://github.com/earendil-works/pi' },
    ],
    editLink: {
      pattern: 'https://github.com/earendil-works/pi/edit/main/docs/:path',
      text: '在 GitHub 上编辑此页',
    },
    footer: {
      message: '基于 MIT 协议发布',
      copyright: '© 2026 Pi Agent 教程 contributors',
    },
    search: {
      provider: 'local',
    },
  },

  head: [
    ['link', { rel: 'icon', href: '/logo.svg' }],
  ],

  markdown: {
    lineNumbers: true,
    config: (md) => {
      // 可在此注册自定义 markdown-it 插件
    },
  },

  mermaid: {
    theme: 'base',
    themeVariables: {
      primaryColor: '#e1f5fe',
      primaryTextColor: '#01579b',
      primaryBorderColor: '#0288d1',
      lineColor: '#0288d1',
      secondaryColor: '#fff3e0',
      tertiaryColor: '#e8f5e9',
      fontFamily: 'Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
      fontSize: '14px',
    },
    flowchart: {
      curve: 'basis',
      padding: 16,
    },
    sequence: {
      mirrorActors: false,
      bottomMarginAdj: 10,
    },
  },
}))

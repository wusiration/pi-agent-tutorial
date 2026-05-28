import { createServer } from './api/server.js'

async function main() {
  const app = await createServer()
  const port = parseInt(process.env.PORT || '3000')

  await app.listen({ port, host: '0.0.0.0' })
  console.log(`🚀 Server running at http://localhost:${port}`)
  console.log(`📚 API docs:`)
  console.log(`   GET  /api/health          - 健康检查`)
  console.log(`   GET  /api/tools           - 工具列表`)
  console.log(`   POST /api/sessions        - 创建会话`)
  console.log(`   POST /api/chat            - 发送消息 (SSE)`)
  console.log(`   POST /api/reset           - 重置会话`)
  console.log(`   GET  /api/history         - 获取历史`)
  console.log(`   GET  /api/export          - 导出会话`)
}

main().catch(console.error)

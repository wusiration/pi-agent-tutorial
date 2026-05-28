import { Type } from '@sinclair/typebox'
import type { AgentTool } from '../core/types.js'

export const searchTool: AgentTool = {
  name: 'search',
  label: '搜索',
  description: '模拟网络搜索，返回与查询词相关的摘要信息',
  parameters: Type.Object({
    query: Type.String({
      description: '搜索关键词',
      minLength: 1,
      maxLength: 200,
    }),
    limit: Type.Optional(Type.Number({
      description: '返回结果数量',
      default: 3,
      minimum: 1,
      maximum: 10,
    })),
  }),
  execute: async (id, params) => {
    const limit = params.limit || 3
    const results = Array.from({ length: limit }, (_, i) => `结果 ${i + 1}: 关于 "${params.query}" 的相关信息...`)

    return {
      content: [{ type: 'text', text: `搜索 "${params.query}":\n${results.join('\n')}` }],
      details: { query: params.query, resultsCount: limit },
    }
  },
}

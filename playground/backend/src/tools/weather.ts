import { Type } from '@sinclair/typebox'
import type { AgentTool } from '../core/types.js'

export const weatherTool: AgentTool = {
  name: 'weather',
  label: '天气查询',
  description: '查询指定城市的当前天气（演示用，返回模拟数据）',
  parameters: Type.Object({
    city: Type.String({
      description: '城市名称，如 "北京"、"Shanghai"',
      minLength: 1,
      maxLength: 50,
    }),
  }),
  execute: async (id, params) => {
    const conditions = ['晴天', '多云', '小雨', '大雨', '雷阵雨', '雪']
    const condition = conditions[Math.floor(Math.random() * conditions.length)]
    const temp = Math.floor(Math.random() * 30) + 5

    return {
      content: [{ type: 'text', text: `${params.city}当前天气：${condition}，${temp}°C` }],
      details: { source: 'mock', city: params.city },
    }
  },
}

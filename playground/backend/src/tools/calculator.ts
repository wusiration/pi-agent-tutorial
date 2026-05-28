import { Type } from '@sinclair/typebox'
import type { AgentTool } from '../core/types.js'

// 安全的数学表达式解析器（替代 eval/Function）
function safeEvaluate(expression: string): number {
  // 只允许数字、运算符、括号和空格
  const sanitized = expression.replace(/[^0-9+\-*/().\s]/g, '')
  if (sanitized !== expression.trim()) {
    throw new Error('表达式包含非法字符')
  }

  // 使用 Function 构造器但严格限制输入
  // 只允许纯数学运算，不提供任何全局变量访问
  const fn = new Function('"use strict"; return (' + sanitized + ')')
  const result = fn()

  if (typeof result !== 'number' || !isFinite(result)) {
    throw new Error('计算结果无效')
  }

  return result
}

export const calculatorTool: AgentTool = {
  name: 'calculator',
  label: '计算器',
  description: '执行安全的数学计算，支持 + - * / 和括号',
  parameters: Type.Object({
    expression: Type.String({
      description: '数学表达式，如 "2 + 2" 或 "(100 - 30) * 2"',
      examples: ['2 + 2', '123 * 456', '(100 - 30) / 5'],
    }),
  }),
  execute: async (id, params) => {
    try {
      const result = safeEvaluate(params.expression)
      return {
        content: [{ type: 'text', text: String(result) }],
        details: { expression: params.expression },
      }
    } catch (e: any) {
      throw new Error(`计算错误: ${e.message}`)
    }
  },
}

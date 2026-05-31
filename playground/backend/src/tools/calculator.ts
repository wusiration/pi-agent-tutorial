import { Type } from '@sinclair/typebox'
import type { AgentTool } from '../core/types.js'

// 安全的数学表达式解析器（不使用 eval/Function）
// 仅支持：数字、+ - * / 、括号、空格

function tokenize(expression: string): (number | string)[] {
  const tokens: (number | string)[] = []
  let i = 0
  while (i < expression.length) {
    const ch = expression[i]
    if (/\s/.test(ch)) {
      i++
      continue
    }
    if (/\d/.test(ch)) {
      let num = ''
      while (i < expression.length && (/\d/.test(expression[i]) || expression[i] === '.')) {
        num += expression[i]
        i++
      }
      tokens.push(parseFloat(num))
      continue
    }
    if ('+-*/()'.includes(ch)) {
      tokens.push(ch)
      i++
      continue
    }
    throw new Error(`非法字符: "${ch}"`)
  }
  return tokens
}

function parseExpression(tokens: (number | string)[], pos: { index: number }): number {
  let value = parseTerm(tokens, pos)
  while (pos.index < tokens.length) {
    const op = tokens[pos.index]
    if (op === '+' || op === '-') {
      pos.index++
      const right = parseTerm(tokens, pos)
      value = op === '+' ? value + right : value - right
    } else {
      break
    }
  }
  return value
}

function parseTerm(tokens: (number | string)[], pos: { index: number }): number {
  let value = parseFactor(tokens, pos)
  while (pos.index < tokens.length) {
    const op = tokens[pos.index]
    if (op === '*' || op === '/') {
      pos.index++
      const right = parseFactor(tokens, pos)
      if (op === '*') {
        value = value * right
      } else {
        if (right === 0) throw new Error('除零错误')
        value = value / right
      }
    } else {
      break
    }
  }
  return value
}

function parseFactor(tokens: (number | string)[], pos: { index: number }): number {
  const token = tokens[pos.index]
  if (typeof token === 'number') {
    pos.index++
    return token
  }
  if (token === '(') {
    pos.index++
    const value = parseExpression(tokens, pos)
    if (tokens[pos.index] !== ')') {
      throw new Error('缺少右括号')
    }
    pos.index++
    return value
  }
  if (token === '-') {
    pos.index++
    return -parseFactor(tokens, pos)
  }
  throw new Error(`意外的符号: ${token}`)
}

function safeEvaluate(expression: string): number {
  // 白名单预检查
  if (!/^[0-9+\-*/().\s]+$/.test(expression)) {
    throw new Error('表达式包含非法字符，仅支持数字和 + - * / ( )')
  }

  const tokens = tokenize(expression)
  if (tokens.length === 0) {
    throw new Error('空表达式')
  }

  const pos = { index: 0 }
  const result = parseExpression(tokens, pos)

  if (pos.index !== tokens.length) {
    throw new Error('表达式解析未完成，请检查语法')
  }

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
      minLength: 1,
      maxLength: 200,
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

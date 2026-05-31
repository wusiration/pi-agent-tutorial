import { describe, it, expect } from 'vitest'

describe('OpenAI Client', () => {
  it('should decode UTF-8 characters split across chunks', () => {
    const text = '北京天气'
    const encoder = new TextEncoder()
    const bytes = encoder.encode(text)

    // 故意在中文字符中间拆分字节
    const chunk1 = bytes.slice(0, 5) // 拆分第一个中文字符
    const chunk2 = bytes.slice(5)

    const decoder = new TextDecoder()
    let result = ''

    result += decoder.decode(chunk1, { stream: true })
    result += decoder.decode(chunk2, { stream: true })
    result += decoder.decode() // flush

    expect(result).toBe('北京天气')
  })
})

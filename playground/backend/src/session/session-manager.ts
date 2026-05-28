import type { Message } from '../../../shared/types.js'

interface SessionData {
  messages: Message[]
  createdAt: number
  lastAccessedAt: number
}

interface SessionManagerOptions {
  ttlMs?: number        // 会话过期时间（毫秒）
  maxSessions?: number  // 最大会话数
  maxMessages?: number  // 单个会话最大消息数
}

export class SessionManager {
  private sessions = new Map<string, SessionData>()
  private options: Required<SessionManagerOptions>

  constructor(options: SessionManagerOptions = {}) {
    this.options = {
      ttlMs: options.ttlMs || 24 * 60 * 60 * 1000, // 默认 24 小时
      maxSessions: options.maxSessions || 1000,
      maxMessages: options.maxMessages || 500,
    }

    // 启动清理定时器
    this.startCleanupTimer()
  }

  create(sessionId: string): void {
    this.evictIfNeeded()

    this.sessions.set(sessionId, {
      messages: [],
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    })
  }

  get(sessionId: string): SessionData | undefined {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.lastAccessedAt = Date.now()
    }
    return session
  }

  getMessages(sessionId: string): Message[] {
    return this.get(sessionId)?.messages || []
  }

  setMessages(sessionId: string, messages: Message[]): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      // 限制消息数量
      if (messages.length > this.options.maxMessages) {
        messages = messages.slice(-this.options.maxMessages)
      }
      session.messages = messages
      session.lastAccessedAt = Date.now()
    }
  }

  appendMessage(sessionId: string, message: Message): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.messages.push(message)
      // 限制消息数量
      if (session.messages.length > this.options.maxMessages) {
        session.messages = session.messages.slice(-this.options.maxMessages)
      }
      session.lastAccessedAt = Date.now()
    }
  }

  clear(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.messages = []
      session.lastAccessedAt = Date.now()
    }
  }

  delete(sessionId: string): void {
    this.sessions.delete(sessionId)
  }

  getAllSessionIds(): string[] {
    return Array.from(this.sessions.keys())
  }

  getStats(): { totalSessions: number; totalMessages: number } {
    let totalMessages = 0
    for (const session of this.sessions.values()) {
      totalMessages += session.messages.length
    }
    return {
      totalSessions: this.sessions.size,
      totalMessages,
    }
  }

  private evictIfNeeded(): void {
    if (this.sessions.size < this.options.maxSessions) return

    // LRU 淘汰：删除最久未访问的会话
    let oldestId: string | null = null
    let oldestTime = Infinity

    for (const [id, session] of this.sessions.entries()) {
      if (session.lastAccessedAt < oldestTime) {
        oldestTime = session.lastAccessedAt
        oldestId = id
      }
    }

    if (oldestId) {
      this.sessions.delete(oldestId)
    }
  }

  private cleanup(): void {
    const now = Date.now()
    const expiredIds: string[] = []

    for (const [id, session] of this.sessions.entries()) {
      if (now - session.lastAccessedAt > this.options.ttlMs) {
        expiredIds.push(id)
      }
    }

    for (const id of expiredIds) {
      this.sessions.delete(id)
    }

    if (expiredIds.length > 0) {
      console.log(`[SessionManager] Cleaned up ${expiredIds.length} expired sessions`)
    }
  }

  private cleanupTimer: NodeJS.Timeout | null = null

  private startCleanupTimer(): void {
    // 每 10 分钟清理一次过期会话
    this.cleanupTimer = setInterval(() => {
      this.cleanup()
    }, 10 * 60 * 1000)
  }

  dispose(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer)
      this.cleanupTimer = null
    }
    this.sessions.clear()
  }
}

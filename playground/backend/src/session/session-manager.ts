import type { Message } from '../../../shared/types.js'
import type { Agent } from '../core/agent.js'

interface SessionEntry {
  agent: Agent
  createdAt: number
  lastAccessedAt: number
}

interface SessionManagerOptions {
  ttlMs?: number        // 会话过期时间（毫秒）
  maxSessions?: number  // 最大会话数
  maxMessages?: number  // 单个会话最大消息数
}

export class SessionManager {
  private sessions = new Map<string, SessionEntry>()
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

  create(sessionId: string, agent: Agent): void {
    this.evictIfNeeded()

    this.sessions.set(sessionId, {
      agent,
      createdAt: Date.now(),
      lastAccessedAt: Date.now(),
    })
  }

  get(sessionId: string): SessionEntry | undefined {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.lastAccessedAt = Date.now()
    }
    return session
  }

  getAgent(sessionId: string): Agent | undefined {
    return this.get(sessionId)?.agent
  }

  getMessages(sessionId: string): Message[] {
    return this.get(sessionId)?.agent.state.messages || []
  }

  clear(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.agent.reset()
      session.lastAccessedAt = Date.now()
    }
  }

  delete(sessionId: string): void {
    const session = this.sessions.get(sessionId)
    if (session) {
      session.agent.abort?.()
      session.agent.reset?.()
    }
    this.sessions.delete(sessionId)
  }

  getAllSessionIds(): string[] {
    return Array.from(this.sessions.keys())
  }

  getStats(): { totalSessions: number; totalMessages: number } {
    let totalMessages = 0
    for (const session of this.sessions.values()) {
      totalMessages += session.agent.state.messages.length
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
      this.delete(oldestId)
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
      this.delete(id)
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
    for (const session of this.sessions.values()) {
      session.agent.abort?.()
    }
    this.sessions.clear()
  }
}

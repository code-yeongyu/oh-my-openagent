export interface FailedReadinessSessionSeed {
  sessionId: string
  title: string
}

export interface FailedReadinessSession extends FailedReadinessSessionSeed {
  rememberedAt: number
}

export interface FailedReadinessCacheOptions {
  ttlMs: number
  sweepIntervalMs: number
  log: (message: string, data?: unknown) => void
}

export class FailedReadinessCache {
  private readonly sessions = new Map<string, FailedReadinessSession>()
  private sweepInterval?: ReturnType<typeof setInterval>
  private readonly ttlMs: number
  private readonly sweepIntervalMs: number
  private readonly log: (message: string, data?: unknown) => void

  constructor(options: FailedReadinessCacheOptions) {
    this.ttlMs = options.ttlMs
    this.sweepIntervalMs = options.sweepIntervalMs
    this.log = options.log
  }

  remember(session: FailedReadinessSessionSeed): void {
    this.sessions.set(session.sessionId, {
      ...session,
      rememberedAt: Date.now(),
    })
    this.startSweep()
  }

  clear(sessionId: string): void {
    this.sessions.delete(sessionId)
    if (this.sessions.size === 0) {
      this.stopSweep()
    }
  }

  get(sessionId: string): FailedReadinessSession | undefined {
    const session = this.sessions.get(sessionId)
    if (!session) {
      return undefined
    }

    if (!this.isExpired(session, Date.now())) {
      return session
    }

    this.sessions.delete(sessionId)
    this.log("[tmux-session-manager] expired failed readiness session on access", {
      sessionId,
      ttlMs: this.ttlMs,
    })

    if (this.sessions.size === 0) {
      this.stopSweep()
    }

    return undefined
  }

  clearAll(): void {
    this.sessions.clear()
    this.stopSweep()
  }

  private isExpired(session: FailedReadinessSession, now: number): boolean {
    return now - session.rememberedAt >= this.ttlMs
  }

  private startSweep(): void {
    if (this.sweepInterval) {
      return
    }

    this.sweepInterval = setInterval(() => {
      this.sweepExpired()
    }, this.sweepIntervalMs)
  }

  private stopSweep(): void {
    if (!this.sweepInterval) {
      return
    }

    clearInterval(this.sweepInterval)
    this.sweepInterval = undefined
  }

  private sweepExpired(): void {
    const now = Date.now()

    for (const [sessionId, session] of this.sessions.entries()) {
      if (!this.isExpired(session, now)) {
        continue
      }

      this.sessions.delete(sessionId)
      this.log("[tmux-session-manager] expired failed readiness session", {
        sessionId,
        ttlMs: this.ttlMs,
      })
    }

    if (this.sessions.size === 0) {
      this.stopSweep()
    }
  }
}

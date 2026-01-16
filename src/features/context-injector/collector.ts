import type {
  ContextEntry,
  ContextPriority,
  PendingContext,
  RegisterContextOptions,
} from "./types"

const PRIORITY_ORDER: Record<ContextPriority, number> = {
  critical: 0,
  high: 1,
  normal: 2,
  low: 3,
}

const CONTEXT_SEPARATOR = "\n\n---\n\n"

type ConsumedHistoryEntry = {
  keys: Set<string>
  lastTouchedAt: number
}

export class ContextCollector {
  private sessions: Map<string, Map<string, ContextEntry>> = new Map()
  private consumedHistory: Map<string, ConsumedHistoryEntry> = new Map()

  private readonly consumedHistoryMaxSessions = 1000
  private readonly consumedHistoryTtlMs = 1000 * 60 * 60 * 24

  register(sessionID: string, options: RegisterContextOptions): void {
    const key = `${options.source}:${options.id}`

    this.pruneConsumedHistory(Date.now())

    // Check if this context has already been consumed in this session
    if (options.once) {
      const history = this.ensureConsumedHistory(sessionID, Date.now())
      if (history.keys.has(key)) {
        return
      }
    }

    if (!this.sessions.has(sessionID)) {
      this.sessions.set(sessionID, new Map())
    }

    const sessionMap = this.sessions.get(sessionID)!

    const entry: ContextEntry = {
      id: options.id,
      source: options.source,
      content: options.content,
      priority: options.priority ?? "normal",
      timestamp: Date.now(),
      metadata: options.metadata,
      once: options.once,
    }

    sessionMap.set(key, entry)
  }

  getPending(sessionID: string): PendingContext {
    const sessionMap = this.sessions.get(sessionID)

    if (!sessionMap || sessionMap.size === 0) {
      return {
        merged: "",
        entries: [],
        hasContent: false,
      }
    }

    const entries = this.sortEntries([...sessionMap.values()])
    const merged = entries.map((e) => e.content).join(CONTEXT_SEPARATOR)

    return {
      merged,
      entries,
      hasContent: entries.length > 0,
    }
  }

  consume(sessionID: string): PendingContext {
    const now = Date.now()
    const pending = this.getPending(sessionID)

    this.pruneConsumedHistory(now)

    // Mark 'once' entries as consumed
    if (pending.hasContent) {
      const history = this.ensureConsumedHistory(sessionID, now)

      for (const entry of pending.entries) {
        if (entry.once) {
          history.keys.add(`${entry.source}:${entry.id}`)
        }
      }
    }

    this.clear(sessionID)
    return pending
  }

  clear(sessionID: string): void {
    this.sessions.delete(sessionID)
  }

  clearHistory(sessionID: string): void {
    this.consumedHistory.delete(sessionID)
  }

  private ensureConsumedHistory(sessionID: string, now: number): ConsumedHistoryEntry {
    const existing = this.consumedHistory.get(sessionID)
    if (existing) {
      existing.lastTouchedAt = now
      return existing
    }

    const entry: ConsumedHistoryEntry = { keys: new Set(), lastTouchedAt: now }
    this.consumedHistory.set(sessionID, entry)
    return entry
  }

  private pruneConsumedHistory(now: number): void {
    if (this.consumedHistory.size === 0) return

    for (const [sessionID, entry] of this.consumedHistory.entries()) {
      if (now - entry.lastTouchedAt > this.consumedHistoryTtlMs) {
        this.consumedHistory.delete(sessionID)
      }
    }

    if (this.consumedHistory.size <= this.consumedHistoryMaxSessions) return

    const entries = [...this.consumedHistory.entries()].sort(
      (a, b) => a[1].lastTouchedAt - b[1].lastTouchedAt
    )

    const overBy = this.consumedHistory.size - this.consumedHistoryMaxSessions
    for (let i = 0; i < overBy; i++) {
      this.consumedHistory.delete(entries[i][0])
    }
  }

  hasPending(sessionID: string): boolean {
    const sessionMap = this.sessions.get(sessionID)
    return sessionMap !== undefined && sessionMap.size > 0
  }

  private sortEntries(entries: ContextEntry[]): ContextEntry[] {
    return entries.sort((a, b) => {
      const priorityDiff = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]
      if (priorityDiff !== 0) return priorityDiff
      return a.timestamp - b.timestamp
    })
  }
}

export const contextCollector = new ContextCollector()

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

export class ContextCollector {
  private sessions: Map<string, Map<string, ContextEntry>> = new Map()

  register(sessionID: string, options: RegisterContextOptions): void {
    if (!this.sessions.has(sessionID)) {
      this.sessions.set(sessionID, new Map())
    }

    const sessionMap = this.sessions.get(sessionID)!
    const key = `${options.source}:${options.id}`

    const entry: ContextEntry = {
      id: options.id,
      source: options.source,
      content: options.content,
      priority: options.priority ?? "normal",
      timestamp: Date.now(),
      metadata: options.metadata,
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
    const pending = this.getPending(sessionID)
    this.clear(sessionID)
    return pending
  }

  clear(sessionID: string): void {
    this.sessions.delete(sessionID)
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

interface ResponseCompletionDedupeEntry {
  readonly keys: Set<string>
  lastTouchedAt: number
}

export interface ResponseCompletionDedupeStore {
  readonly size: number
  markHandled: (sessionID: string, dedupeKey: string) => boolean
  clearSession: (sessionID: string) => void
  prune: () => void
}

export interface ResponseCompletionDedupeStoreOptions {
  ttlMs?: number
  maxSessions?: number
  now?: () => number
}

const DEFAULT_DEDUPE_TTL_MS = 10 * 60 * 1000
const DEFAULT_MAX_DEDUPE_SESSIONS = 256

export function createResponseCompletionDedupeStore(
  options: ResponseCompletionDedupeStoreOptions = {},
): ResponseCompletionDedupeStore {
  const entries = new Map<string, ResponseCompletionDedupeEntry>()
  const ttlMs = options.ttlMs ?? DEFAULT_DEDUPE_TTL_MS
  const maxSessions = Math.max(1, options.maxSessions ?? DEFAULT_MAX_DEDUPE_SESSIONS)
  const now = options.now ?? Date.now

  function pruneExpired(currentTime: number): void {
    for (const [sessionID, entry] of entries.entries()) {
      if (currentTime - entry.lastTouchedAt > ttlMs) {
        entries.delete(sessionID)
      }
    }
  }

  function pruneOverflow(): void {
    while (entries.size > maxSessions) {
      let oldestSessionID: string | undefined
      let oldestTouchedAt = Number.POSITIVE_INFINITY
      for (const [sessionID, entry] of entries.entries()) {
        if (entry.lastTouchedAt < oldestTouchedAt) {
          oldestTouchedAt = entry.lastTouchedAt
          oldestSessionID = sessionID
        }
      }
      if (!oldestSessionID) return
      entries.delete(oldestSessionID)
    }
  }

  function prune(): void {
    pruneExpired(now())
    pruneOverflow()
  }

  function markHandled(sessionID: string, dedupeKey: string): boolean {
    const currentTime = now()
    pruneExpired(currentTime)
    let entry = entries.get(sessionID)
    if (!entry) {
      entry = { keys: new Set<string>(), lastTouchedAt: currentTime }
      entries.set(sessionID, entry)
    }
    entry.lastTouchedAt = currentTime
    pruneOverflow()
    if (entry.keys.has(dedupeKey)) {
      return false
    }
    entry.keys.add(dedupeKey)
    return true
  }

  function clearSession(sessionID: string): void {
    entries.delete(sessionID)
  }

  return {
    get size() {
      return entries.size
    },
    markHandled,
    clearSession,
    prune,
  }
}

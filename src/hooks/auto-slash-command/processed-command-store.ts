const MAX_PROCESSED_ENTRY_COUNT = 10_000
const PROCESSED_COMMAND_TTL_MS = 30_000

function pruneExpiredEntries(entries: Map<string, number>, now: number): Map<string, number> {
  return new Map(Array.from(entries.entries()).filter(([, expiresAt]) => expiresAt > now))
}

function trimProcessedEntries(entries: Map<string, number>): Map<string, number> {
  if (entries.size <= MAX_PROCESSED_ENTRY_COUNT) {
    return entries
  }

  return new Map(
    Array.from(entries.entries())
      .sort((left, right) => left[1] - right[1])
      .slice(Math.floor(entries.size / 2))
  )
}

function removeSessionEntries(entries: Map<string, number>, sessionID: string): Map<string, number> {
  const sessionPrefix = `${sessionID}:`
  return new Map(Array.from(entries.entries()).filter(([entry]) => !entry.startsWith(sessionPrefix)))
}

export interface ProcessedCommandStore {
  has(commandKey: string): boolean
  add(commandKey: string, ttlMs?: number): void
  cleanupSession(sessionID: string): void
  clear(): void
}

export function createProcessedCommandStore(): ProcessedCommandStore {
  let entries = new Map<string, number>()

  return {
    has(commandKey: string): boolean {
      const now = Date.now()
      entries = pruneExpiredEntries(entries, now)
      return entries.has(commandKey)
    },
    add(commandKey: string, ttlMs = PROCESSED_COMMAND_TTL_MS): void {
      const now = Date.now()
      entries = pruneExpiredEntries(entries, now)
      entries.delete(commandKey)
      entries.set(commandKey, now + ttlMs)
      entries = trimProcessedEntries(entries)
    },
    cleanupSession(sessionID: string): void {
      entries = removeSessionEntries(entries, sessionID)
    },
    clear(): void {
      entries.clear()
    },
  }
}

const MAX_PROCESSED_ENTRY_COUNT = 10_000
const PROCESSED_COMMAND_TTL_MS = 30_000

function pruneExpiredEntries(entries: Map<string, number>, now: number): void {
  for (const [commandKey, expiresAt] of entries) {
    if (expiresAt <= now) {
      entries.delete(commandKey)
    }
  }
}

function trimProcessedEntries(entries: Map<string, number>): void {
  if (entries.size <= MAX_PROCESSED_ENTRY_COUNT) {
    return
  }

  const targetSize = Math.floor(entries.size / 2)
  for (const commandKey of entries.keys()) {
    if (entries.size <= targetSize) {
      return
    }

    entries.delete(commandKey)
  }
}

function removeSessionEntries(entries: Map<string, number>, sessionID: string): void {
  const sessionPrefix = `${sessionID}:`
  for (const entry of entries.keys()) {
    if (entry.startsWith(sessionPrefix)) {
      entries.delete(entry)
    }
  }
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
      const expiresAt = entries.get(commandKey)
      if (expiresAt === undefined) {
        return false
      }

      if (expiresAt <= Date.now()) {
        entries.delete(commandKey)
        return false
      }

      return true
    },
    add(commandKey: string, ttlMs = PROCESSED_COMMAND_TTL_MS): void {
      const now = Date.now()
      pruneExpiredEntries(entries, now)
      entries.delete(commandKey)
      entries.set(commandKey, now + ttlMs)
      trimProcessedEntries(entries)
    },
    cleanupSession(sessionID: string): void {
      removeSessionEntries(entries, sessionID)
    },
    clear(): void {
      entries.clear()
    },
  }
}

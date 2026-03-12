const MAX_PROCESSED_ENTRY_COUNT = 10_000

function trimProcessedEntries(entries: Set<string>): Set<string> {
  if (entries.size <= MAX_PROCESSED_ENTRY_COUNT) {
    return entries
  }

  return new Set(Array.from(entries).slice(Math.floor(entries.size / 2)))
}

function removeSessionEntries(entries: Set<string>, sessionID: string): Set<string> {
  const sessionPrefix = `${sessionID}:`
  return new Set(Array.from(entries).filter((entry) => !entry.startsWith(sessionPrefix)))
}

export interface ProcessedCommandStore {
  has(commandKey: string): boolean
  add(commandKey: string): void
  cleanupSession(sessionID: string): void
  clear(): void
}

export function createProcessedCommandStore(): ProcessedCommandStore {
  let entries = new Set<string>()

  return {
    has(commandKey: string): boolean {
      return entries.has(commandKey)
    },
    add(commandKey: string): void {
      entries.add(commandKey)
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

export type CacheEntry = {
  content: string
  hash: string
  size: number
  lastUsedTurn: number
}

const cache = new Map<string, Map<string, CacheEntry>>()

export function getCache(sessionID: string, filePath: string): CacheEntry | undefined {
  return cache.get(sessionID)?.get(filePath)
}

export function setCache(
  sessionID: string,
  filePath: string,
  entry: Omit<CacheEntry, "lastUsedTurn"> & { lastUsedTurn?: number }
): void {
  let sessionMap = cache.get(sessionID)
  if (!sessionMap) {
    sessionMap = new Map()
    cache.set(sessionID, sessionMap)
  }
  sessionMap.set(filePath, {
    ...entry,
    lastUsedTurn: entry.lastUsedTurn ?? 0,
  })
}

export function clearSessionCache(sessionID: string): void {
  cache.delete(sessionID)
}

export function getSessionEntries(sessionID: string): Map<string, CacheEntry> | undefined {
  return cache.get(sessionID)
}

export function _resetForTesting(): void {
  cache.clear()
}

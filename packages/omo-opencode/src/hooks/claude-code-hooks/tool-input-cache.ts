/**
 * Caches tool_input from PreToolUse for PostToolUse
 */

interface CacheEntry {
  toolInput: Record<string, unknown>
  timestamp: number
}

const cache = new Map<string, CacheEntry>()

const CACHE_TTL = 60000 // 1 minute

let cleanupInterval: ReturnType<typeof setInterval> | null = null

function pruneExpiredToolInputs(): void {
  const now = Date.now()
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key)
    }
  }
}

function ensureCleanupInterval(): void {
  if (cleanupInterval) return

  cleanupInterval = setInterval(() => {
    pruneExpiredToolInputs()
  }, CACHE_TTL)

  if (typeof cleanupInterval === "object" && "unref" in cleanupInterval) {
    cleanupInterval.unref()
  }
}

export function cacheToolInput(
  sessionId: string,
  toolName: string,
  invocationId: string,
  toolInput: Record<string, unknown>
): void {
  ensureCleanupInterval()
  const key = `${sessionId}:${toolName}:${invocationId}`
  cache.set(key, { toolInput, timestamp: Date.now() })
}

export function getToolInput(
  sessionId: string,
  toolName: string,
  invocationId: string
): Record<string, unknown> | null {
  const key = `${sessionId}:${toolName}:${invocationId}`
  const entry = cache.get(key)
  if (!entry) return null

  cache.delete(key)
  if (Date.now() - entry.timestamp > CACHE_TTL) return null

  return entry.toolInput
}

export function clearToolInputCache(sessionId?: string): void {
  if (!sessionId) {
    cache.clear()
    return
  }

  const sessionPrefix = `${sessionId}:`
  for (const key of cache.keys()) {
    if (key.startsWith(sessionPrefix)) {
      cache.delete(key)
    }
  }
}

export function stopToolInputCacheCleanup(): void {
  clearToolInputCache()
  if (!cleanupInterval) return
  clearInterval(cleanupInterval)
  cleanupInterval = null
}

/**
 * Caches tool_input from PreToolUse for PostToolUse
 */

interface CacheEntry {
  toolInput: Record<string, unknown>
  timestamp: number
}

const cache = new Map<string, CacheEntry>()

const CACHE_TTL = 60000 // 1 minute

export function cacheToolInput(
  sessionId: string,
  toolName: string,
  invocationId: string,
  toolInput: Record<string, unknown>
): void {
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

// Periodic cleanup (every minute)
setInterval(() => {
  const now = Date.now()
  for (const [key, entry] of cache.entries()) {
    if (now - entry.timestamp > CACHE_TTL) {
      cache.delete(key)
    }
  }
}, CACHE_TTL)

import { log } from "../../shared/logger"

const CACHEABLE_SUBAGENTS = new Set(["explore", "librarian"])

function normalizePrompt(prompt: string): string {
  return prompt.trim().replace(/\s+/g, " ")
}

function makeCacheKey(subagentType: string, prompt: string): string {
  return `${subagentType}::${normalizePrompt(prompt)}`
}

interface CacheEntry {
  result: string
  hitCount: number
  storedAt: number
}

const sessionCache = new Map<string, Map<string, CacheEntry>>()

export function isExploreSubagent(subagentType: string | undefined): boolean {
  if (!subagentType) return false
  return CACHEABLE_SUBAGENTS.has(subagentType.toLowerCase())
}

export function getExploreCache(
  parentSessionID: string,
  subagentType: string,
  prompt: string,
): string | undefined {
  const key = makeCacheKey(subagentType, prompt)
  const entry = sessionCache.get(parentSessionID)?.get(key)
  if (!entry) return undefined

  entry.hitCount++
  log("[explore-result-cache] Cache HIT", {
    parentSessionID,
    subagentType,
    key: key.slice(0, 80),
    hitCount: entry.hitCount,
  })
  return entry.result
}

export function storeExploreCache(
  parentSessionID: string,
  subagentType: string,
  prompt: string,
  result: string,
): void {
  const key = makeCacheKey(subagentType, prompt)
  let sessionMap = sessionCache.get(parentSessionID)
  if (!sessionMap) {
    sessionMap = new Map()
    sessionCache.set(parentSessionID, sessionMap)
  }
  if (!sessionMap.has(key)) {
    sessionMap.set(key, { result, hitCount: 0, storedAt: Date.now() })
    log("[explore-result-cache] Cache STORED", {
      parentSessionID,
      subagentType,
      key: key.slice(0, 80),
      resultLength: result.length,
    })
  }
}

export function clearExploreCacheForSession(parentSessionID: string): void {
  sessionCache.delete(parentSessionID)
}

export function clearAllExploreCache(): void {
  sessionCache.clear()
}

export function getExploreCacheStats(parentSessionID: string): {
  entries: number
  totalHits: number
} {
  const sessionMap = sessionCache.get(parentSessionID)
  if (!sessionMap) return { entries: 0, totalHits: 0 }
  let totalHits = 0
  for (const entry of sessionMap.values()) {
    totalHits += entry.hitCount
  }
  return { entries: sessionMap.size, totalHits }
}

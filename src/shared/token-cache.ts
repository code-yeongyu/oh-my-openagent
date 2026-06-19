export interface TokenInfo {
  input: number
  output: number
  reasoning: number
  cache: { read: number; write: number }
}

export interface CachedTokenEntry {
  providerID: string
  modelID: string
  tokens: TokenInfo
  updatedAt: number
}

const cache = new Map<string, CachedTokenEntry>()
const STALE_THRESHOLD_MS = 30_000

export function updateTokenCache(
  sessionID: string,
  data: { providerID: string; modelID?: string; tokens: TokenInfo },
): void {
  cache.set(sessionID, {
    providerID: data.providerID,
    modelID: data.modelID ?? "",
    tokens: data.tokens,
    updatedAt: Date.now(),
  })
}

export function getCachedTokenUsage(
  sessionID: string,
  staleThresholdMs = STALE_THRESHOLD_MS,
): CachedTokenEntry | null {
  const entry = cache.get(sessionID)
  if (!entry) return null
  if (Date.now() - entry.updatedAt > staleThresholdMs) return null
  return entry
}

export function getCachedTokenEntry(sessionID: string): CachedTokenEntry | undefined {
  return cache.get(sessionID)
}

export function clearTokenCache(sessionID: string): void {
  cache.delete(sessionID)
}

export function getTotalInputTokens(sessionID: string): number | null {
  const entry = cache.get(sessionID)
  if (!entry) return null
  return (entry.tokens.input ?? 0) + (entry.tokens.cache?.read ?? 0)
}

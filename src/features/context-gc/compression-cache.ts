const processedMessagesBySession = new Map<string, Set<string>>()

export function isProcessed(sessionID: string, messageID: string): boolean {
  return processedMessagesBySession.get(sessionID)?.has(messageID) ?? false
}

export function markProcessed(sessionID: string, messageID: string): void {
  const existing = processedMessagesBySession.get(sessionID)
  if (existing) {
    existing.add(messageID)
    return
  }

  processedMessagesBySession.set(sessionID, new Set([messageID]))
}

export function clearSession(sessionID: string): void {
  processedMessagesBySession.delete(sessionID)
}

type CompressionTier = "warm" | "cold" | "gone"

const TIER_DEPTH: Record<CompressionTier, number> = {
  warm: 1,
  cold: 2,
  gone: 3,
}

const compressionTierBySession = new Map<string, Map<string, CompressionTier>>()

export function getCompressionTier(sessionID: string, messageID: string): CompressionTier | null {
  return compressionTierBySession.get(sessionID)?.get(messageID) ?? null
}

export function setCompressionTier(sessionID: string, messageID: string, tier: CompressionTier): void {
  const existing = compressionTierBySession.get(sessionID)
  if (existing) {
    existing.set(messageID, tier)
    return
  }
  compressionTierBySession.set(sessionID, new Map([[messageID, tier]]))
}

export function isAlreadyCompressedAt(sessionID: string, messageID: string, tier: CompressionTier): boolean {
  const cached = getCompressionTier(sessionID, messageID)
  if (!cached) return false
  return TIER_DEPTH[cached] >= TIER_DEPTH[tier]
}

export function clearCompressionTiers(sessionID: string): void {
  compressionTierBySession.delete(sessionID)
}

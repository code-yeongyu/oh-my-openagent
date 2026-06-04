import { isRecord } from "./error-classifier"

type AssistantTurnInfo = {
  readonly role?: unknown
  readonly finish?: unknown
  readonly tokens?: unknown
}

function getTokenCount(tokens: unknown, key: "input" | "output" | "reasoning"): number | undefined {
  const tokenRecord = isRecord(tokens) ? tokens : undefined
  if (!tokenRecord) {
    return undefined
  }
  const value = tokenRecord[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function getCacheTokenCount(tokens: unknown, key: "write" | "read"): number | undefined {
  const tokenRecord = isRecord(tokens) ? tokens : undefined
  const cacheRecord = isRecord(tokenRecord?.cache) ? tokenRecord.cache : undefined
  if (!cacheRecord) {
    return undefined
  }
  const value = cacheRecord[key]
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function allTokenCountsIndicateNoProgress(tokens: unknown): boolean {
  const coreCounts = [
    getTokenCount(tokens, "input"),
    getTokenCount(tokens, "output"),
    getTokenCount(tokens, "reasoning"),
  ]
  const cacheCounts = [
    getCacheTokenCount(tokens, "write"),
    getCacheTokenCount(tokens, "read"),
  ]
  const cachePresent = cacheCounts.some((count) => count !== undefined)
  return coreCounts.every((count) => count === 0)
    && (!cachePresent || cacheCounts.every((count) => count === 0))
}

export function isEmptyNoProgressAssistantTurnInfo(info: unknown): info is AssistantTurnInfo {
  const infoRecord = isRecord(info) ? info : undefined
  return !!infoRecord
    && infoRecord.role === "assistant"
    && infoRecord.finish === "unknown"
    && allTokenCountsIndicateNoProgress(infoRecord.tokens)
}

import type { EpistemicState } from "./types"
import type { HistoryEntry, ConclusionHistory } from "./transition-types"

const store = new Map<string, Map<string, ConclusionHistory>>()
const hydratedSessions = new Set<string>()
const invocationCounter = new Map<string, number>()

export function getSessionInvocationCount(sessionID: string): number {
  return invocationCounter.get(sessionID) ?? 0
}

export function incrementSessionInvocationCount(sessionID: string): number {
  const current = invocationCounter.get(sessionID) ?? 0
  const next = current + 1
  invocationCounter.set(sessionID, next)
  return next
}

export function getHistory(sessionID: string, conclusion: string): ConclusionHistory | undefined {
  return store.get(sessionID)?.get(conclusion)
}

export function updateHistory(
  sessionID: string,
  conclusion: string,
  entry: HistoryEntry,
  newState: EpistemicState,
  currentInvocation = 0,
  options?: { exclusionTheoryHash?: string },
): void {
  let sessionMap = store.get(sessionID)
  if (!sessionMap) {
    sessionMap = new Map()
    store.set(sessionID, sessionMap)
  }

  const existing = sessionMap.get(conclusion)

  if (!existing) {
    sessionMap.set(conclusion, {
      currentState: newState,
      entries: [entry],
      consecutiveCount: 1,
      lastClassification: entry.classification,
      lastSeenInvocation: currentInvocation,
      exclusionTheoryHash: options?.exclusionTheoryHash,
    })
    return
  }

  const isSameClassification = entry.classification === existing.lastClassification
  const consecutiveCount = isSameClassification ? existing.consecutiveCount + 1 : 1

  sessionMap.set(conclusion, {
    currentState: newState,
    entries: [...existing.entries, entry],
    consecutiveCount,
    lastClassification: entry.classification,
    lastSeenInvocation: currentInvocation,
    exclusionTheoryHash:
      options?.exclusionTheoryHash !== undefined
        ? options.exclusionTheoryHash
        : newState === "excluded"
          ? existing.exclusionTheoryHash
          : undefined,
  })
}

export function hydrate(sessionID: string, data: Record<string, ConclusionHistory>): void {
  const sessionMap = new Map<string, ConclusionHistory>()
  for (const [key, history] of Object.entries(data)) {
    sessionMap.set(key, history)
  }
  store.set(sessionID, sessionMap)
  hydratedSessions.add(sessionID)
}

export function snapshot(sessionID: string): Record<string, ConclusionHistory> {
  const sessionMap = store.get(sessionID)
  if (!sessionMap) return {}

  const result: Record<string, ConclusionHistory> = {}
  for (const [key, history] of sessionMap.entries()) {
    result[key] = history
  }
  return result
}

export function clearHistory(sessionID: string): void {
  store.delete(sessionID)
  hydratedSessions.delete(sessionID)
  invocationCounter.delete(sessionID)
}

export function isHydrated(sessionID: string): boolean {
  return hydratedSessions.has(sessionID)
}

export function _resetForTesting(): void {
  store.clear()
  hydratedSessions.clear()
  invocationCounter.clear()
}

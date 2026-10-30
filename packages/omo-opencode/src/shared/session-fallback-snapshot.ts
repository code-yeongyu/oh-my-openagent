import type { FallbackEntry } from "./model-requirements"

const sessionFallbackSnapshots = new Map<string, FallbackEntry[]>()

function cloneChain(chain: FallbackEntry[]): FallbackEntry[] {
  return chain.map((entry) => ({ ...entry, providers: [...entry.providers], ...(entry.thinking ? { thinking: { ...entry.thinking } } : {}) }))
}

/** Undefined means unregistered; an empty snapshot deliberately disables inherited fallbacks. */
export function setSessionFallbackSnapshot(sessionID: string, chain: FallbackEntry[] | undefined): void {
  sessionFallbackSnapshots.set(sessionID, cloneChain(chain ?? []))
}

export function getSessionFallbackSnapshot(sessionID: string): FallbackEntry[] | undefined {
  const chain = sessionFallbackSnapshots.get(sessionID)
  return chain ? cloneChain(chain) : undefined
}

export function clearSessionFallbackSnapshot(sessionID: string): void {
  sessionFallbackSnapshots.delete(sessionID)
}

export function clearAllSessionFallbackSnapshots(): void {
  sessionFallbackSnapshots.clear()
}

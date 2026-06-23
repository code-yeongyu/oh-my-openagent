import type { PolicyVerdict } from "../reasoning-core-policy-gate/types.ts"

const TTL_MS = 30_000

interface StoredVerdict {
  verdict: PolicyVerdict
  timestamp: number
}

const store = new Map<string, StoredVerdict>()

export function storeVerdict(key: string, verdict: PolicyVerdict): void {
  store.set(key, { verdict, timestamp: Date.now() })
}

export function getVerdict(key: string): PolicyVerdict | undefined {
  const entry = store.get(key)
  if (!entry) return undefined
  if (Date.now() - entry.timestamp > TTL_MS) {
    store.delete(key)
    return undefined
  }
  return entry.verdict
}

export function clearSession(sessionID: string): void {
  for (const key of store.keys()) {
    if (key.startsWith(`${sessionID}:`)) {
      store.delete(key)
    }
  }
}

export function _resetForTesting(): void {
  store.clear()
}

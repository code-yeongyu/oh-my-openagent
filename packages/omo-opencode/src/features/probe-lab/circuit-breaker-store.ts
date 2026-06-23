import { createCircuitBreaker } from "../../mcp/idm-browser/pool/circuit-breaker"
import type { ProbeStore } from "./sqlite-store"
import type { Identity } from "./types"

export type ProbeCircuitConfig = {
  failureThreshold: number
  resetTimeoutMs: number
  halfOpenMaxAttempts: number
}

const DEFAULT_CONFIG: ProbeCircuitConfig = {
  failureThreshold: 3,
  resetTimeoutMs: 300_000,
  halfOpenMaxAttempts: 1,
}

export function createPersistentBreaker(args: {
  store: ProbeStore
  identity: Identity
  config?: Partial<ProbeCircuitConfig>
}) {
  const cfg = { ...DEFAULT_CONFIG, ...args.config }
  const breaker = createCircuitBreaker(args.identity.id, cfg)

  if (args.identity.consecutive_failures >= cfg.failureThreshold) {
    for (let i = 0; i < args.identity.consecutive_failures; i++) {
      breaker.recordFailure()
    }
  }

  function flush(extra?: { quarantineFor?: number }): void {
    const info = breaker.getInfo()
    const now = Math.floor(Date.now() / 1000)
    const quarantinedUntil = extra?.quarantineFor != null
      ? now + extra.quarantineFor
      : info.state === "open"
      ? now + Math.floor(cfg.resetTimeoutMs / 1000)
      : null
    args.store.setIdentityCircuitState({
      id: args.identity.id,
      state: info.state,
      consecutiveFailures: info.failureCount,
      lastFailureAt: info.lastFailureAt
        ? Math.floor(info.lastFailureAt / 1000)
        : null,
      quarantinedUntil,
      status: info.state === "open" ? "quarantined" : "active",
    })
  }

  function recordSuccess(): void {
    breaker.recordSuccess()
    flush()
  }

  function recordFailure(): void {
    breaker.recordFailure()
    flush()
  }

  return {
    canAttempt: breaker.canAttempt,
    assertOpen: breaker.assertOpen,
    getState: breaker.getState,
    getInfo: breaker.getInfo,
    recordSuccess,
    recordFailure,
  }
}

export type PersistentBreaker = ReturnType<typeof createPersistentBreaker>

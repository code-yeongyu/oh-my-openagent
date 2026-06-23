import { CircuitOpenError } from "../types"

export type CircuitState = "closed" | "open" | "half_open"

export type CircuitBreakerConfig = {
  failureThreshold: number
  resetTimeoutMs: number
  halfOpenMaxAttempts: number
}

const DEFAULT_CONFIG: CircuitBreakerConfig = {
  failureThreshold: 5,
  resetTimeoutMs: 60_000,
  halfOpenMaxAttempts: 1,
}

export function createCircuitBreaker(host: string, config: Partial<CircuitBreakerConfig> = {}) {
  const cfg = { ...DEFAULT_CONFIG, ...config }
  let state: CircuitState = "closed"
  let failureCount = 0
  let lastFailureAt = 0
  let halfOpenAttempts = 0

  function getState(): CircuitState {
    if (state === "open") {
      const elapsed = Date.now() - lastFailureAt
      if (elapsed >= cfg.resetTimeoutMs) {
        state = "half_open"
        halfOpenAttempts = 0
      }
    }
    return state
  }

  function canAttempt(): boolean {
    const current = getState()
    if (current === "closed") return true
    if (current === "half_open") return halfOpenAttempts < cfg.halfOpenMaxAttempts
    return false
  }

  function recordSuccess(): void {
    failureCount = 0
    state = "closed"
    halfOpenAttempts = 0
  }

  function recordFailure(): void {
    failureCount++
    lastFailureAt = Date.now()

    if (getState() === "half_open") {
      state = "open"
      return
    }

    if (failureCount >= cfg.failureThreshold) {
      state = "open"
    }
  }

  function assertOpen(): void {
    if (!canAttempt()) {
      const retryAfterMs = cfg.resetTimeoutMs - (Date.now() - lastFailureAt)
      throw new CircuitOpenError(host, Math.max(0, retryAfterMs))
    }
    if (getState() === "half_open") {
      halfOpenAttempts++
    }
  }

  function getInfo() {
    return { host, state: getState(), failureCount, lastFailureAt }
  }

  return { canAttempt, recordSuccess, recordFailure, assertOpen, getState, getInfo }
}

export type CircuitBreaker = ReturnType<typeof createCircuitBreaker>

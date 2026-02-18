const RETRY_DELAYS_MS = [50, 250, 500, 1000, 2000, 5000] as const

const inFlightSessions = new Set<string>()
const retryAttempts = new Map<string, number>()
const retryTimers = new Map<string, ReturnType<typeof setTimeout>>()

export function isApplyInFlight(sessionID: string): boolean {
  return inFlightSessions.has(sessionID)
}

export function markApplyInFlight(sessionID: string): void {
  inFlightSessions.add(sessionID)
}

export function clearRetryState(sessionID: string): void {
  const timer = retryTimers.get(sessionID)
  if (timer) {
    clearTimeout(timer)
    retryTimers.delete(sessionID)
  }
  retryAttempts.delete(sessionID)
  inFlightSessions.delete(sessionID)
}

export function clearInFlight(sessionID: string): void {
  inFlightSessions.delete(sessionID)
}

export function scheduleRetry(args: {
  sessionID: string
  source: string
  retryFn: (attemptNumber: number) => void
  onLimitReached: (attempts: number) => void
}): void {
  const { sessionID, retryFn, onLimitReached } = args
  const attempts = retryAttempts.get(sessionID) ?? 0
  if (attempts >= RETRY_DELAYS_MS.length) {
    onLimitReached(attempts)
    return
  }

  const delay = RETRY_DELAYS_MS[attempts]
  retryAttempts.set(sessionID, attempts + 1)

  const existing = retryTimers.get(sessionID)
  if (existing) {
    clearTimeout(existing)
  }

  const timer = setTimeout(() => {
    retryTimers.delete(sessionID)
    retryFn(attempts + 1)
  }, delay)

  retryTimers.set(sessionID, timer)
}

/** @internal For testing only */
export function resetRetryStateForTesting(): void {
  for (const timer of retryTimers.values()) {
    clearTimeout(timer)
  }
  retryTimers.clear()
  retryAttempts.clear()
  inFlightSessions.clear()
}

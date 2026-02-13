import type { SessionState } from "./types"

// TTL for idle session state entries (10 minutes)
const SESSION_STATE_TTL_MS = 10 * 60 * 1000
// Prune interval (every 2 minutes)
const SESSION_STATE_PRUNE_INTERVAL_MS = 2 * 60 * 1000

interface TrackedSessionState {
  state: SessionState
  lastAccessedAt: number
}

export interface SessionStateStore {
  getState: (sessionID: string) => SessionState
  getExistingState: (sessionID: string) => SessionState | undefined
  cancelCountdown: (sessionID: string) => void
  cleanup: (sessionID: string) => void
  cancelAllCountdowns: () => void
  shutdown: () => void
}

export function createSessionStateStore(): SessionStateStore {
  const sessions = new Map<string, TrackedSessionState>()

  // Periodic pruning of stale session states to prevent unbounded Map growth
  let pruneInterval: ReturnType<typeof setInterval> | undefined
  pruneInterval = setInterval(() => {
    const now = Date.now()
    for (const [sessionID, tracked] of sessions.entries()) {
      if (now - tracked.lastAccessedAt > SESSION_STATE_TTL_MS) {
        cancelCountdown(sessionID)
        sessions.delete(sessionID)
      }
    }
  }, SESSION_STATE_PRUNE_INTERVAL_MS)
  // Allow process to exit naturally even if interval is running
  if (typeof pruneInterval === "object" && "unref" in pruneInterval) {
    pruneInterval.unref()
  }

  function getState(sessionID: string): SessionState {
    const existing = sessions.get(sessionID)
    if (existing) {
      existing.lastAccessedAt = Date.now()
      return existing.state
    }

    const state: SessionState = {}
    sessions.set(sessionID, { state, lastAccessedAt: Date.now() })
    return state
  }

  function getExistingState(sessionID: string): SessionState | undefined {
    const existing = sessions.get(sessionID)
    if (existing) {
      existing.lastAccessedAt = Date.now()
      return existing.state
    }
    return undefined
  }

  function cancelCountdown(sessionID: string): void {
    const tracked = sessions.get(sessionID)
    if (!tracked) return

    const state = tracked.state
    if (state.countdownTimer) {
      clearTimeout(state.countdownTimer)
      state.countdownTimer = undefined
    }

    if (state.countdownInterval) {
      clearInterval(state.countdownInterval)
      state.countdownInterval = undefined
    }

    state.inFlight = false
    state.countdownStartedAt = undefined
  }

  function cleanup(sessionID: string): void {
    cancelCountdown(sessionID)
    sessions.delete(sessionID)
  }

  function cancelAllCountdowns(): void {
    for (const sessionID of sessions.keys()) {
      cancelCountdown(sessionID)
    }
  }

  function shutdown(): void {
    clearInterval(pruneInterval)
    cancelAllCountdowns()
    sessions.clear()
  }

  return {
    getState,
    getExistingState,
    cancelCountdown,
    cleanup,
    cancelAllCountdowns,
    shutdown,
  }
}

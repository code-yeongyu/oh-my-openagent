import type { SessionState } from "./types"

export interface SessionStateStore {
  getState: (sessionID: string) => SessionState
  getExistingState: (sessionID: string) => SessionState | undefined
  cancelCountdown: (sessionID: string) => void
  cleanup: (sessionID: string) => void
  cancelAllCountdowns: () => void
}

export function createSessionStateStore(): SessionStateStore {
  const sessions = new Map<string, SessionState>()

  function getState(sessionID: string): SessionState {
    const existingState = sessions.get(sessionID)
    if (existingState) return existingState

    const state: SessionState = {}
    sessions.set(sessionID, state)
    return state
  }

  function getExistingState(sessionID: string): SessionState | undefined {
    return sessions.get(sessionID)
  }

  function cancelCountdown(sessionID: string): void {
    const state = sessions.get(sessionID)
    if (!state) return

    if (state.countdownTimer) {
      clearTimeout(state.countdownTimer)
      state.countdownTimer = undefined
    }

    if (state.countdownInterval) {
      clearInterval(state.countdownInterval)
      state.countdownInterval = undefined
    }

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

  return {
    getState,
    getExistingState,
    cancelCountdown,
    cleanup,
    cancelAllCountdowns,
  }
}

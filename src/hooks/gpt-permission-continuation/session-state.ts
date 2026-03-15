type SessionState = {
  inFlight: boolean
  consecutiveAutoContinueCount: number
  awaitingAutoContinuationResponse: boolean
  lastHandledMessageID?: string
  lastAutoContinuePermissionPhrase?: string
  lastInjectedAt?: number
}

export type SessionStateStore = ReturnType<typeof createSessionStateStore>

export function createSessionStateStore() {
  const states = new Map<string, SessionState>()

  const getState = (sessionID: string): SessionState => {
    const existing = states.get(sessionID)
    if (existing) return existing

    const created: SessionState = {
      inFlight: false,
      consecutiveAutoContinueCount: 0,
      awaitingAutoContinuationResponse: false,
    }
    states.set(sessionID, created)
    return created
  }

  return {
    getState,
    wasRecentlyInjected(sessionID: string, windowMs: number): boolean {
      const state = states.get(sessionID)
      if (!state?.lastInjectedAt) return false
      return Date.now() - state.lastInjectedAt <= windowMs
    },
    cleanup(sessionID: string): void {
      states.delete(sessionID)
    },
  }
}

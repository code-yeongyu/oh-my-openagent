import { parseToolResultContext } from "./hook-input"

export interface CheckerSessionState {
  readonly reportedFilesThisTurn: Set<string>
  checkerFailed: boolean
}

// One component object serves every session the process loads (omo's entry builds its components once), so the
// per-turn record and a failed start belong to the session whose event carries them, never to the component.
export function createCheckerSessions() {
  const sessions = new Map<string, CheckerSessionState>()
  return {
    of(eventContext: unknown): CheckerSessionState {
      const key = sessionKey(eventContext)
      let state = sessions.get(key)
      if (state === undefined) {
        state = { reportedFilesThisTurn: new Set<string>(), checkerFailed: false }
        sessions.set(key, state)
      }
      return state
    },
    end(eventContext: unknown): void {
      sessions.delete(sessionKey(eventContext))
    },
  }
}

function sessionKey(eventContext: unknown): string {
  return parseToolResultContext(eventContext).sessionManager?.getSessionId?.() ?? "unknown"
}

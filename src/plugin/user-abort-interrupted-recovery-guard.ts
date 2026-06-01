const USER_ABORT_ERROR_NAMES = new Set(["MessageAbortedError", "AbortError"])

export type UserAbortInterruptedRecoveryGuard = {
  readonly noteSessionError: (sessionID: string, errorName: string | undefined) => boolean
  readonly shouldSkipRecovery: (sessionID: string) => boolean
  readonly clear: (sessionID: string) => void
}

export function createUserAbortInterruptedRecoveryGuard(): UserAbortInterruptedRecoveryGuard {
  const abortedSessions = new Set<string>()

  return {
    noteSessionError(sessionID, errorName) {
      if (!errorName || !USER_ABORT_ERROR_NAMES.has(errorName)) {
        return false
      }
      abortedSessions.add(sessionID)
      return true
    },
    shouldSkipRecovery(sessionID) {
      return abortedSessions.has(sessionID)
    },
    clear(sessionID) {
      abortedSessions.delete(sessionID)
    },
  }
}

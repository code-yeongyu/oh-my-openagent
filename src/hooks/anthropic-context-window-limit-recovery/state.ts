import type { AutoCompactState, RetryState, TruncateState } from "./types"

export function getOrCreateRetryState(
  autoCompactState: AutoCompactState,
  sessionID: string,
): RetryState {
  let state = autoCompactState.retryStateBySession.get(sessionID)
  if (!state) {
    state = { attempt: 0, lastAttemptTime: 0 }
    autoCompactState.retryStateBySession.set(sessionID, state)
  }
  return state
}

export function getOrCreateTruncateState(
  autoCompactState: AutoCompactState,
  sessionID: string,
): TruncateState {
  let state = autoCompactState.truncateStateBySession.get(sessionID)
  if (!state) {
    state = { truncateAttempt: 0 }
    autoCompactState.truncateStateBySession.set(sessionID, state)
  }
  return state
}

export function clearSessionState(
  autoCompactState: AutoCompactState,
  sessionID: string,
): void {
  autoCompactState.pendingCompact.delete(sessionID)
  autoCompactState.errorDataBySession.delete(sessionID)
  autoCompactState.retryStateBySession.delete(sessionID)
  autoCompactState.truncateStateBySession.delete(sessionID)
  autoCompactState.emptyContentAttemptBySession.delete(sessionID)
  autoCompactState.compactionInProgress.delete(sessionID)
}

export function getEmptyContentAttempt(
  autoCompactState: AutoCompactState,
  sessionID: string,
): number {
  return autoCompactState.emptyContentAttemptBySession.get(sessionID) ?? 0
}

export function incrementEmptyContentAttempt(
  autoCompactState: AutoCompactState,
  sessionID: string,
): number {
  const attempt = getEmptyContentAttempt(autoCompactState, sessionID)
  autoCompactState.emptyContentAttemptBySession.set(sessionID, attempt + 1)
  return attempt
}

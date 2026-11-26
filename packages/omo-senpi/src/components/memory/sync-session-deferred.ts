// The device session cannot be resolved now for a reason that clears without a configuration change: the OS
// credential store is waiting for a person to answer its approval dialog (#11262), or the memory repository has no
// first commit yet (#13486). Thrown from the device account
// sidecar and recognized in the entry bundle by code, like SyncConfigError: each bundle carries its own copy of this class.

export const SYNC_SESSION_DEFERRED = "sync-session-deferred"

export class SyncSessionDeferredError extends Error {
  readonly code = SYNC_SESSION_DEFERRED

  /**
   * @param wake Aborts when the reason to wait may have ended before the retry delay (the account the waiting pass
   *   resolved signed out or lost its channel, #13624): the runner retries at once instead of reporting waiting.
   */
  constructor(
    message: string,
    cause: unknown,
    readonly wake?: AbortSignal,
  ) {
    super(message, { cause })
    this.name = "SyncSessionDeferredError"
  }
}

export function isSyncSessionDeferred(error: unknown): error is SyncSessionDeferredError {
  return error instanceof Error && (error as { code?: unknown }).code === SYNC_SESSION_DEFERRED
}

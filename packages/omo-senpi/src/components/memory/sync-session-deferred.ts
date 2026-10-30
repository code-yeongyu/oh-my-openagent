// The device session cannot be resolved now for a reason that clears without a configuration change: the OS
// credential store is waiting for a person to answer its approval dialog (#11262). Thrown from the device account
// sidecar and recognized in the entry bundle by code, like SyncConfigError: each bundle carries its own copy of this class.

export const SYNC_SESSION_DEFERRED = "sync-session-deferred"

export class SyncSessionDeferredError extends Error {
  readonly code = SYNC_SESSION_DEFERRED

  constructor(message: string, cause: unknown) {
    super(message, { cause })
    this.name = "SyncSessionDeferredError"
  }
}

export function isSyncSessionDeferred(error: unknown): error is SyncSessionDeferredError {
  return error instanceof Error && (error as { code?: unknown }).code === SYNC_SESSION_DEFERRED
}

// A memory sync configuration value the user set is invalid. Thrown from the device account sidecar and
// recognized in the entry bundle, so the check is by code and shape rather than instanceof: each bundle
// carries its own copy of this class.

export const SYNC_CONFIG_INVALID = "sync-config-invalid"

export class SyncConfigError extends Error {
  readonly code = SYNC_CONFIG_INVALID

  constructor(readonly variable: string, cause: unknown) {
    super(`${variable} is not a valid service URL: ${cause instanceof Error ? cause.message : String(cause)}`, { cause })
    this.name = "SyncConfigError"
  }
}

export function isSyncConfigError(error: unknown): error is SyncConfigError {
  return error instanceof Error && (error as { code?: unknown }).code === SYNC_CONFIG_INVALID && typeof (error as { variable?: unknown }).variable === "string"
}

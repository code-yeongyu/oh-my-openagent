/** `0` disables a limit; both at `0` reproduces the unbounded, name-ordered listing byte for byte. */
export interface ExternalProjectionLimits {
  readonly maxEntriesPerDirectory: number
  readonly maxBytes: number
}

export const DEFAULT_EXTERNAL_PROJECTION_LIMITS: ExternalProjectionLimits = {
  maxEntriesPerDirectory: 0,
  maxBytes: 40_960,
}

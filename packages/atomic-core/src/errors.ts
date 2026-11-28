const ATOMIC_ERROR_CODES = [
  "binary_missing",
  "version_unsupported",
  "unsupported_platform",
  "unsupported_capability",
  "unauthorized",
  "not_repository",
  "identity_missing",
  "recording_owner_conflict",
  "recording_owner_unknown",
  "spawn_failed",
  "timeout",
  "cancelled",
  "output_limit",
  "command_failed",
  "invalid_response",
  "invalid_input",
  "lock_timeout",
  "unsafe_path",
  "ownership_mismatch",
  "review_blocked",
  "promotion_conflict",
  "operation_indeterminate",
  "cleanup_incomplete",
] as const

export type AtomicErrorCode = (typeof ATOMIC_ERROR_CODES)[number]

type ErrorPolicy = { readonly transient: boolean; readonly recovery: string }

const ERROR_POLICY: Readonly<Record<AtomicErrorCode, ErrorPolicy>> = {
  binary_missing: { transient: false, recovery: "Install Atomic 0.22.x or set atomic.binary_path in the user omo.json." },
  version_unsupported: { transient: false, recovery: "Install an Atomic 0.22.x release (0.22.1 or newer)." },
  unsupported_platform: { transient: false, recovery: "This Atomic operation is not supported on this platform yet." },
  unsupported_capability: { transient: false, recovery: "This Atomic release does not provide the required capability." },
  unauthorized: { transient: false, recovery: "Enable Atomic in the user omo.json; project config cannot enable it." },
  not_repository: { transient: false, recovery: "Run 'atomic init' in the repository, then retry." },
  identity_missing: { transient: false, recovery: "Create an identity with 'atomic identity new <name> --email <email> --set-default'." },
  recording_owner_conflict: { transient: false, recovery: "Set atomic.recording.owner so exactly one recorder owns the session." },
  recording_owner_unknown: { transient: false, recovery: "Set atomic.recording.owner to 'omo' or 'external' explicitly." },
  spawn_failed: { transient: true, recovery: "Check that the Atomic executable exists and is executable." },
  timeout: { transient: true, recovery: "The Atomic command exceeded its time budget; retry or raise the configured timeout." },
  cancelled: { transient: true, recovery: "The Atomic command was cancelled before it finished." },
  output_limit: { transient: false, recovery: "Narrow the request; the Atomic output exceeded its byte limit." },
  command_failed: { transient: false, recovery: "Inspect the Atomic diagnostic and correct the request." },
  invalid_response: { transient: false, recovery: "The Atomic output did not match the pinned 0.22.x contract; check the installed version." },
  invalid_input: { transient: false, recovery: "Correct the arguments and retry the Atomic operation." },
  lock_timeout: { transient: true, recovery: "Another process holds the repository mutation lock; retry later." },
  unsafe_path: { transient: false, recovery: "Use a repository-relative path without '..' segments." },
  ownership_mismatch: { transient: false, recovery: "The resource belongs to another owner; it was left untouched." },
  review_blocked: { transient: false, recovery: "Resolve the blocking triage findings before promotion." },
  promotion_conflict: { transient: false, recovery: "Resolve the conflicting changes, then promote again." },
  operation_indeterminate: { transient: false, recovery: "Inspect the repository state before retrying; the outcome is unknown." },
  cleanup_incomplete: { transient: true, recovery: "Some resources remain; the next sweep retries their cleanup." },
}

const DIAGNOSTIC_LIMIT_CHARS = 1024
const SECRET_ASSIGNMENT = /\b(token|secret|password|passwd|api[_-]?key|authorization)(\s*[=:]\s*)\S+/gi

/** Bounds a CLI diagnostic for logs and masks secret-looking assignments. */
function boundAtomicDiagnostic(text: string): string {
  const masked = text.replace(SECRET_ASSIGNMENT, "$1$2[redacted]").trim()
  return masked.length <= DIAGNOSTIC_LIMIT_CHARS ? masked : `${masked.slice(0, DIAGNOSTIC_LIMIT_CHARS)}...[truncated]`
}

export type AtomicErrorInit = {
  readonly operation: string
  /** True when the failed command may already have changed repository or vault state. */
  readonly sideEffectsPossible: boolean
  readonly message?: string
  readonly diagnostic?: string
}

export class AtomicError extends Error {
  readonly code: AtomicErrorCode
  readonly operation: string
  readonly retryable: boolean
  readonly sideEffectsPossible: boolean
  readonly recovery: string
  readonly diagnostic: string | undefined

  constructor(code: AtomicErrorCode, init: AtomicErrorInit) {
    super(init.message ?? `atomic ${init.operation} failed: ${code}`)
    this.name = "AtomicError"
    this.code = code
    this.operation = init.operation
    this.sideEffectsPossible = init.sideEffectsPossible
    this.retryable = ERROR_POLICY[code].transient && !init.sideEffectsPossible
    this.recovery = ERROR_POLICY[code].recovery
    this.diagnostic = init.diagnostic === undefined ? undefined : boundAtomicDiagnostic(init.diagnostic)
  }
}

export const ENROLL_STEPS = [
  "request",
  "reach",
  "preflight",
  "install",
  "account_state",
  "sign_in",
  "device_service",
  "read_back",
] as const
export type EnrollStep = (typeof ENROLL_STEPS)[number]

export type EnrollCode =
  | "invalid_request"
  | "ssh_unreachable"
  | "ssh_auth_failed"
  | "ssh_host_unverified"
  | "unsupported_platform"
  | "install_failed"
  | "signed_in_elsewhere"
  | "device_revoked_here"
  | "credential_store_locked"
  | "credential_store_unavailable"
  | "approval_expired"
  | "approval_denied"
  | "device_limit"
  | "machine_exists"
  | "accounts_unreachable"
  | "device_service_off"
  | "not_online_before_deadline"
  | "aborted"
  | "caller_signed_out"
  | "internal_error"

export type StepReceipt = {
  readonly step: EnrollStep
  readonly outcome: "ok" | "skipped" | "refused"
  /** A short machine-readable note built on the caller (never remote output). */
  readonly note?: string
}

export type EnrolledDevice = { readonly id: string; readonly name: string; readonly platform?: string }

export type EnrollOutcome =
  | {
      readonly kind: "enrolled"
      readonly api: string
      readonly device: EnrolledDevice
      readonly already: boolean
      readonly steps: readonly StepReceipt[]
    }
  | {
      readonly kind: "refused"
      readonly api: string
      readonly step: EnrollStep
      readonly code: EnrollCode
      readonly message: string
      readonly next_action: string
      readonly details?: Readonly<Record<string, unknown>>
      readonly steps: readonly StepReceipt[]
    }

export class StepRefusal extends Error {
  constructor(
    readonly code: EnrollCode,
    readonly reason: string,
    readonly nextAction: string,
    readonly details?: Readonly<Record<string, unknown>>,
  ) {
    super(reason)
  }
}

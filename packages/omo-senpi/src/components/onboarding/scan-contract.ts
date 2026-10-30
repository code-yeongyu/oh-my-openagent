/** Pull: `extension_request` with `OnboardingScanRequest`; answers `OnboardingScanResponse`. */
export const ONBOARDING_SCAN_RPC_METHOD = "omo.onboarding.scan"
/** Push: one `extension_event` frame per `OnboardingScanEvent`, under this name. */
export const ONBOARDING_SCAN_RPC_EVENT = "omo.onboarding.scan.event"
/** Pull: `extension_request` with `OnboardingApplyRequest`; answers `OnboardingApplyResponse`. */
export const ONBOARDING_APPLY_RPC_METHOD = "omo.onboarding.apply"

export type OnboardingScanSource = "detect" | "providers" | "credentials" | "assets" | "model-choices" | "projects" | "sessions"
/** The stages `omo.onboarding.apply` accepts; `detect` only reads, so it has none. */
export type OnboardingApplyStage = "credentials" | "assets" | "providers" | "model-choices"

export interface OnboardingScanRequest {
  /** OpenCode custom and catalog providers; off unless asked for. */
  readonly includeCustomProviders?: boolean
}

export type OnboardingScanResponse = { readonly scanId: string } | OnboardingUnavailable

export interface OnboardingScanItem {
  readonly id: string
  readonly kind: string
  readonly state: string
  readonly detail?: string
  /** On a `sessions` item: the project directory the session ran in. */
  readonly project?: string
}

export interface OnboardingScanCounts {
  readonly found: number
  readonly read: number
  /** The most a source reads; `null` for a source that reads everything it finds. */
  readonly cap: number | null
}

export interface OnboardingScanEvent {
  readonly scanId: string
  readonly kind: "source_started" | "item" | "source_done" | "source_failed" | "done"
  /** The source the event belongs to; `"all"` on the final `done`. */
  readonly source: OnboardingScanSource | "all"
  readonly item?: OnboardingScanItem
  readonly counts?: OnboardingScanCounts
  readonly elapsedMs: number
  /** On `source_failed`: why the source could not be read; on a failed scan's final `done`: why the scan failed. */
  readonly reason?: string
}

export interface OnboardingApplyRequest {
  readonly scanId: string
  readonly stages: readonly OnboardingApplyStage[]
}

export type OnboardingApplyResponse =
  | { readonly scanId: string; readonly applied: readonly OnboardingApplyStage[]; readonly notices?: readonly string[] }
  | OnboardingUnavailable
  | { readonly kind: "stale"; readonly reason: string; readonly paths: readonly string[]; readonly applied?: readonly OnboardingApplyStage[] }
  | { readonly kind: "invalid"; readonly reason: string }

export interface OnboardingUnavailable {
  readonly kind: "unavailable"
  readonly reason: string
}

export const ONBOARDING_APPLY_STAGES: readonly OnboardingApplyStage[] = ["credentials", "assets", "providers", "model-choices"]

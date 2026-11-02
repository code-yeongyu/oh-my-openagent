import type { FactsExtractionRecord } from "@oh-my-opencode/memory-core"

import type { OnboardingUnavailable } from "./scan-contract"

/** Pull: `extension_request` with `OnboardingUnderstandRequest`; answers `OnboardingUnderstandResponse`. */
export const ONBOARDING_UNDERSTAND_RPC_METHOD = "omo.onboarding.understand"
/** Push: one `extension_event` frame per `OnboardingUnderstandEvent`, under this name. */
export const ONBOARDING_UNDERSTAND_RPC_EVENT = "omo.onboarding.understand.event"
/** Pull: `OnboardingUnderstandSkipRequest`; the project's step is cancelled or never started. */
export const ONBOARDING_UNDERSTAND_SKIP_RPC_METHOD = "omo.onboarding.understand.skip"
/** Pull: `OnboardingUnderstandStopRequest`; the run ends with the candidates it already has. */
export const ONBOARDING_UNDERSTAND_STOP_RPC_METHOD = "omo.onboarding.understand.stop"

export interface OnboardingUnderstandBudgetLimits {
  /**
   * `record_fact` tool calls across the run, rejected ones included; NOT model calls. Model calls are
   * bounded separately: one per step (one step per project group) plus at most one retry of a failed step.
   */
  readonly toolCalls: number
  readonly readBytes: number
  readonly totalMs: number
  readonly stepMs: number
  readonly maxFacts: number
  readonly minSourceSessions: number
}

export const ONBOARDING_UNDERSTAND_BUDGET: OnboardingUnderstandBudgetLimits = {
  toolCalls: 24,
  readBytes: 240 * 1024,
  totalMs: 90_000,
  stepMs: 15_000,
  maxFacts: 12,
  minSourceSessions: 2,
}

export interface OnboardingUnderstandRequest {
  readonly scanId: string
  /** `provider/model`: the caller's default model. */
  readonly model: string
  /** Required: this stage sends the scan's session digests and each scanned project's AGENTS.md to the model provider. */
  readonly consent: true
}

export type OnboardingUnderstandResponse =
  | { readonly understandId: string }
  | OnboardingUnavailable
  | { readonly kind: "invalid"; readonly reason: string }

export interface OnboardingUnderstandSkipRequest {
  readonly understandId: string
  /** The project directory, as `step.project` and the scan's session items carry it. */
  readonly project: string
}

export interface OnboardingUnderstandStopRequest {
  readonly understandId: string
}

export type OnboardingUnderstandControlResponse =
  | { readonly understandId: string; readonly accepted: true }
  | OnboardingUnavailable
  | { readonly kind: "invalid"; readonly reason: string }

export interface OnboardingUnderstandStep {
  readonly id: string
  /** Human-readable, e.g. "Read 12 recent sessions in omo". */
  readonly label: string
  /** The project directory; absent on the step that reads single-session projects together. */
  readonly project?: string
  readonly sessions: number
}

/** A proposed fact: never applied here; the apply stage writes it through the engine memory path. */
export interface OnboardingFactCandidate {
  readonly id: string
  readonly fact: FactsExtractionRecord
  /** Session keys of the digests the model read when it recorded the fact; at least two. */
  readonly sources: readonly string[]
}

export type OnboardingUnderstandBudgetKind = "tool_calls" | "read_bytes" | "total_ms" | "step_ms" | "max_facts"

export interface OnboardingUnderstandEvent {
  readonly understandId: string
  readonly scanId: string
  readonly kind: "step_started" | "step_done" | "step_failed" | "fact" | "budget" | "done"
  readonly step?: OnboardingUnderstandStep
  readonly fact?: OnboardingFactCandidate
  /** On `budget`: the cap that was reached. */
  readonly budget?: OnboardingUnderstandBudgetKind
  /** Bytes of digests and AGENTS.md read so far in this run. */
  readonly bytesRead: number
  /** `record_fact` calls so far in this run. */
  readonly toolCalls: number
  readonly elapsedMs: number
  /** On `step_failed`: why the model call failed. */
  readonly reason?: string
  /** On `step_failed`: the step runs once more. */
  readonly retrying?: true
  /** On `step_done`: the project was skipped; its facts were dropped. */
  readonly skipped?: true
  /** On `done`: every candidate, in the order found. */
  readonly candidates?: readonly OnboardingFactCandidate[]
  /** On `done`: the model failed twice; onboarding continues with the scan only. */
  readonly fallback?: "scan_only"
  /** On `done`: ended by `omo.onboarding.understand.stop`. */
  readonly stopped?: true
}

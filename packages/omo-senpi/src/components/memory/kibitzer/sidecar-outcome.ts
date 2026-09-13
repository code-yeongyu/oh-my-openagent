// How one resident wake ended. A wake is one child turn: the seed or followUp that started it plus
// every steer the turn absorbed. The sidecar aborts a turn itself for three reasons (the tool
// budget, the wake deadline, session shutdown), and none of them is a child failure: only a turn
// the engine settled as an error, or a child that could not be started, counts toward the
// diagnostic streak that eventually raises the `omo-kibitzer:gate` notice.

import type { RecallNudge } from "@oh-my-opencode/memory-core"
import type { RunnerOutcome } from "@oh-my-opencode/senpi-task"

import { classifyJudgeTurn, normalizeGateReason } from "./judge-outcome"

/** The sidecar's own reasons for aborting a running turn. */
export type KibitzerWakeAbort = "tool_budget" | "deadline" | "shutdown"

export type KibitzerWakeFailureCause = "child_failed" | "child_failed_upstream" | "start_failed"

export type KibitzerWakeEnd =
  /** The engine settled the turn on its own; `nudges` on the outcome says whether it spoke. */
  | { readonly status: "completed" }
  /** The sidecar aborted at the per-wake tool budget. Accepted nudges are kept. */
  | { readonly status: "tool_budget_exceeded" }
  /** The sidecar aborted at the wake deadline. Accepted nudges are kept. */
  | { readonly status: "deadline" }
  /** The child turn failed or the child could not be started; the sidecar backs off. */
  | { readonly status: "failed"; readonly cause: KibitzerWakeFailureCause; readonly reason?: string }
  /** The main session shut down under the turn. Nothing is delivered. */
  | { readonly status: "cancelled"; readonly cause: "shutdown" }

export type KibitzerWakeStatus = KibitzerWakeEnd["status"]

/** Provider usage the wake's assistant messages reported, summed over the turn. */
export interface KibitzerWakeUsage {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  readonly cacheWrite: number
}

/** What `observe.ts` writes as one line of the sidecar's `wakes.ndjson`; every field is a closed value. */
export interface KibitzerWakeOutcome {
  readonly sessionId: string
  /** 1-based turn number across the whole sidecar lifetime, regardless of child generation. */
  readonly wake: number
  /** Which child answered: 1 for the first, +1 per backoff or reseed recreation. */
  readonly generation: number
  readonly status: KibitzerWakeStatus
  readonly cause?: KibitzerWakeFailureCause | "shutdown"
  readonly reason?: string
  readonly model?: string
  /** Nudges the parent re-validated and handed to delivery. */
  readonly nudges: readonly RecallNudge[]
  /** Candidate paths this wake put in front of the child (seed/followUp plus every steer). */
  readonly candidateCount: number
  /** Steer envelopes the turn absorbed after it started. */
  readonly steered: number
  /** Child tool calls counted through the session subscription. */
  readonly toolCalls: number
  readonly durationMs: number
  /** Time the wake waited for its machine-wide lease before the turn could start. */
  readonly slotWaitMs: number
  /** Parent cursor span of the events the wake carried. */
  readonly cursors?: { readonly first: number; readonly last: number }
  /** Context estimate of the child after this wake (provider usage, or char/4 when usage is absent). */
  readonly contextTokens?: number
  /** Tokens the wake's assistant messages reported; absent when the provider reported none. */
  readonly usage?: KibitzerWakeUsage
  /** True only for `failed`: budget, deadline and shutdown never feed the failure streak. */
  readonly diagnostic: boolean
}

/**
 * Reads how a turn ended. A sidecar-initiated abort wins over whatever the engine reports for the
 * aborted turn (it settles as `cancelled`); otherwise the settled outcome is classified the way
 * the one-shot judge classified it, with the "empty response twice" rule keeping a silent child
 * out of the failure streak.
 */
export function classifyWakeEnd(outcome: RunnerOutcome, abort: KibitzerWakeAbort | undefined, accepted: readonly RecallNudge[]): KibitzerWakeEnd {
  switch (abort) {
    case "tool_budget": return { status: "tool_budget_exceeded" }
    case "deadline": return { status: "deadline" }
    case "shutdown": return { status: "cancelled", cause: "shutdown" }
    case undefined: break
    default: abort satisfies never
  }
  const classification = classifyJudgeTurn(outcome, accepted)
  switch (classification.status) {
    case "completed":
    case "empty":
      return { status: "completed" }
    case "failed":
      return { status: "failed", cause: classification.cause, ...(classification.reason === undefined ? {} : { reason: classification.reason }) }
    case "dropped":
      // The engine cancelled a turn the sidecar did not abort: the child is gone from under us.
      return { status: "failed", cause: "child_failed", reason: "child turn was cancelled outside the sidecar" }
    default:
      return classification satisfies never
  }
}

/** A child that never started: the same shape as a failed turn so the streak and backoff treat both alike. */
export function startFailureEnd(error: unknown): Extract<KibitzerWakeEnd, { readonly status: "failed" }> {
  const reason = normalizeGateReason(error instanceof Error ? error.message : String(error))
  return { status: "failed", cause: "start_failed", ...(reason === undefined ? {} : { reason }) }
}

export function isDiagnosticWakeEnd(end: KibitzerWakeEnd): boolean {
  return end.status === "failed"
}

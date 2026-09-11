import type { RunnerOutcome } from "@oh-my-opencode/senpi-task"

import { containsSecretLikeMaterial, type RecallNudge } from "@oh-my-opencode/memory-core"

import { GATE_REASON_MAX_CHARS } from "./notice"

export type JudgeTurnClassification =
  | { readonly status: "completed" }
  /** The judge stopped without nudging and without prose: a completed run with nothing to deliver. */
  | { readonly status: "empty" }
  | { readonly status: "failed"; readonly cause: "child_failed" | "child_failed_upstream"; readonly reason?: string }
  | { readonly status: "dropped"; readonly cause: "cancelled" }

/**
 * senpi's empty-assistant recovery (packages/agent/src/empty-assistant-recovery.ts) retries an
 * invisible stop once and settles the second as this error. The judge is told to answer only
 * through `nudge` and may end silently, so for THIS child the message describes a completed turn,
 * not a failure. The nudge tool terminates the loop once the cap is reached; this rule is the floor
 * for the runs that stop before it (issue #7963).
 */
const EMPTY_RESPONSE_TWICE = "Model returned an empty response twice"

/**
 * The child settles its own turn once its same-model budget and fallback chain are exhausted, so
 * an upstream provider failure is read off the settled outcome. There is no event-stream shortcut:
 * one could fire while the engine is still rotating rungs and abort the recovery it reports.
 */
export function classifyJudgeTurn(outcome: RunnerOutcome, accepted: readonly RecallNudge[]): JudgeTurnClassification {
  if (outcome.status === "completed") return { status: "completed" }
  if (outcome.status === "cancelled") return { status: "dropped", cause: "cancelled" }
  const reason = normalizeGateReason(outcome.failure.message)
  if (reason === EMPTY_RESPONSE_TWICE) return accepted.length > 0 ? { status: "completed" } : { status: "empty" }
  if (reason === undefined) return { status: "failed", cause: "child_failed" }
  return { status: "failed", cause: UPSTREAM_FAILURE_PATTERN.test(reason) ? "child_failed_upstream" : "child_failed", reason }
}

const UPSTREAM_FAILURE_PATTERN = /\b503\b|auth[_ -]?unavailable|overloaded/iu

export function normalizeGateReason(message: string | undefined): string | undefined {
  if (message === undefined) return undefined
  const text = message.replace(/[\u0000-\u001F\u007F-\u009F]/gu, "").replace(/\s+/gu, " ").trim()
  if (text.length === 0) return undefined
  if (containsSecretLikeMaterial(text)) return "redacted"
  return text.length > GATE_REASON_MAX_CHARS
    ? `${text.slice(0, GATE_REASON_MAX_CHARS - 1)}…`
    : text
}

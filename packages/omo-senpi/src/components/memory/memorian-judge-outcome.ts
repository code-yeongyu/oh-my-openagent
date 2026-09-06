import type { RunnerOutcome } from "@oh-my-opencode/senpi-task"

import { containsSecretLikeMaterial } from "@oh-my-opencode/memory-core"

import { GATE_REASON_MAX_CHARS } from "./memorian-notice"

export type JudgeTurnClassification =
  | { readonly status: "completed" }
  | { readonly status: "failed"; readonly cause: "child_failed"; readonly reason?: string }
  | { readonly status: "dropped"; readonly cause: "cancelled" }

export function classifyJudgeTurn(outcome: RunnerOutcome): JudgeTurnClassification {
  if (outcome.status === "completed") return { status: "completed" }
  if (outcome.status === "cancelled") return { status: "dropped", cause: "cancelled" }
  const reason = normalizeGateReason(outcome.failure.message)
  return reason === undefined
    ? { status: "failed", cause: "child_failed" }
    : { status: "failed", cause: "child_failed", reason }
}

export function normalizeGateReason(message: string | undefined): string | undefined {
  if (message === undefined) return undefined
  const text = message.replace(/[\u0000-\u001F\u007F-\u009F]/gu, "").replace(/\s+/gu, " ").trim()
  if (text.length === 0) return undefined
  if (containsSecretLikeMaterial(text)) return "redacted"
  return text.length > GATE_REASON_MAX_CHARS
    ? `${text.slice(0, GATE_REASON_MAX_CHARS - 1)}…`
    : text
}

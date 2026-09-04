import type { SendOutcome } from "../steering"
import { CONTINUE_SUGGESTION } from "./manager-helpers"
import type { ContinueResult } from "./types"

// Adapts the steering engine's SendOutcome onto the narrower ContinueResult the `task` tool's
// continuation route (todo 14) consumes. A queued send maps to a followUp continuation because the
// buffered message is delivered as a follow-up prompt the moment the child starts.
export function toContinueResult(outcome: SendOutcome): ContinueResult {
  switch (outcome.kind) {
    case "steered":
      return { kind: "continued", task_id: outcome.task_id, status: outcome.status, delivered: outcome.delivered }
    case "revived":
      return { kind: "continued", task_id: outcome.task_id, status: "running", delivered: "revive" }
    case "delivery_uncertain":
      return { kind: "not_continuable", task_id: outcome.task_id, reason: outcome.reason, suggestion: outcome.suggestion }
    case "capacity_deferred":
      return { kind: "not_continuable", task_id: outcome.task_id, reason: outcome.reason, suggestion: "Retry the send after capacity frees." }
    case "queued":
      return { kind: "continued", task_id: outcome.task_id, status: "pending", delivered: "followUp" }
    case "not_continuable":
      return { kind: "not_continuable", task_id: outcome.task_id, reason: outcome.reason, suggestion: outcome.suggestion }
    case "one_shot_agent":
      return { kind: "not_continuable", task_id: outcome.task_id, reason: outcome.message, suggestion: CONTINUE_SUGGESTION }
    case "scope_denied":
      return { kind: "not_continuable", task_id: outcome.task_id, reason: outcome.reason, suggestion: CONTINUE_SUGGESTION }
    case "not_found":
      return { kind: "not_continuable", reason: outcome.reason, suggestion: outcome.suggestion }
    default:
      return assertNever(outcome)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected send outcome: ${JSON.stringify(value)}`)
}

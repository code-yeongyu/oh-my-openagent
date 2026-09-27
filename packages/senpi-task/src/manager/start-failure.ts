import { RunnerError } from "../runners/in-process/runner-error"
import {
  HOST_START_FAILURE_REASONS,
  SESSION_START_FAILURE_REASONS,
  isTaskStartFailureReason,
  type TaskStartFailureKind,
  type TaskStartFailureReason,
} from "../state/start-failure"

const GENERIC_START_FAILURE_MESSAGE = "Task runner failed to start."
const MODEL_UNAVAILABLE_MESSAGE = "The task child cannot serve this model."

const REASON_MESSAGES: Readonly<Partial<Record<TaskStartFailureReason, string>>> = {
  model_not_in_child_profile:
    "The task child cannot serve this model: its provider is not present in the child profile.",
  catalog_probe_timed_out:
    "The task child could not confirm this model in time: its model catalog probe timed out.",
  catalog_probe_failed: "The task child cannot serve this model: its model catalog probe failed.",
  host_unreachable: "The shared task host is unreachable (host_unreachable).",
  ensure_failed: "The shared task host could not be ensured (ensure_failed).",
  ensure_timed_out:
    "The shared task host did not become ready before the ensure deadline (ensure_timed_out).",
  open_timed_out:
    "The shared host did not finish opening the child session in time (open_timed_out).",
}

const SESSION_REFUSAL_REASONS = new Set<TaskStartFailureReason>(SESSION_START_FAILURE_REASONS)
const HOST_UNAVAILABLE_REASONS = new Set<TaskStartFailureReason>(HOST_START_FAILURE_REASONS)

export type StartFailureDescription = {
  readonly errorMessage: string
  readonly failureKind?: TaskStartFailureKind
  readonly failureReason?: TaskStartFailureReason
  readonly eventFacts?: Readonly<Record<string, unknown>>
}

export function describeStartFailure(error: unknown): StartFailureDescription {
  if (!RunnerError.is(error)) return { errorMessage: GENERIC_START_FAILURE_MESSAGE }
  const failureKind = error.failure.kind
  const reason = isTaskStartFailureReason(error.failure.reason) ? error.failure.reason : undefined
  const errorMessage = publicMessage(failureKind, reason)
  const { rejected_while: rejectedWhile, exit } = error.failure
  return {
    errorMessage,
    failureKind,
    ...(reason === undefined ? {} : { failureReason: reason }),
    eventFacts: {
      failure_kind: failureKind,
      ...(reason === undefined ? {} : { failure_reason: reason }),
      ...(rejectedWhile === undefined ? {} : { rejected_while: rejectedWhile }),
      ...(exit === undefined
        ? {}
        : { exit_kind: exit.kind, exit_code: exit.code, exit_signal: exit.signal }),
    },
  }
}

function publicMessage(
  kind: TaskStartFailureKind,
  reason: TaskStartFailureReason | undefined,
): string {
  const reasonMessage = reason === undefined ? undefined : REASON_MESSAGES[reason]
  if (reasonMessage !== undefined) return reasonMessage

  switch (kind) {
    case "depth-exceeded":
      return "In-process child depth limit exceeded."
    case "session-create-failed":
      return "In-process child session creation failed."
    case "child-prompt-failed":
      return "Child prompt failed to start."
    case "tools_unavailable":
      return "Parent kernel tools are unavailable for this child."
    case "model_unavailable":
      return MODEL_UNAVAILABLE_MESSAGE
    case "session_unavailable":
      return reason !== undefined && SESSION_REFUSAL_REASONS.has(reason)
        ? `The shared host refused the child session (${reason}).`
        : "The shared host could not open the child session."
    case "host_unavailable":
      return reason !== undefined && HOST_UNAVAILABLE_REASONS.has(reason)
        ? `The shared task host is unavailable (${reason}).`
        : "The shared task host is unavailable."
    case "child-turn-failed":
      return GENERIC_START_FAILURE_MESSAGE
    default:
      return assertNever(kind)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected task start failure kind: ${JSON.stringify(value)}`)
}

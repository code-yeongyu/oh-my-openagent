import { homedir } from "node:os"

import { RunnerError } from "../runners/in-process/runner-error"
import {
  HOST_START_FAILURE_REASONS,
  SESSION_START_FAILURE_REASONS,
  isTaskStartFailureReason,
  type TaskStartFailureKind,
  type TaskStartFailureReason,
} from "../state/start-failure"
import { classifyStartCause, describeStartCause, type StartCause } from "./start-failure-cause"

const GENERIC_START_FAILURE_MESSAGE = "Task runner failed to start."
const MODEL_UNAVAILABLE_MESSAGE = "The task child cannot serve this model."

const REASON_MESSAGES: Readonly<Partial<Record<TaskStartFailureReason, string>>> = {
  model_not_in_child_profile:
    "The task child cannot serve this model: its provider is not present in the child profile.",
  catalog_probe_timed_out:
    "The task child could not confirm this model in time: its model catalog probe timed out.",
  catalog_probe_failed: "The task child cannot serve this model: its model catalog probe failed.",
  host_unreachable: "The task host is unreachable (host_unreachable).",
  ensure_failed: "The task host could not be ensured (ensure_failed).",
  ensure_timed_out:
    "The task host did not become ready before the ensure deadline (ensure_timed_out).",
  shard_socket_too_long:
    "The shard socket path exceeds the platform limit (shard_socket_too_long).",
  shard_alt_root_unsafe:
    "The alternate shard root is unsafe (shard_alt_root_unsafe).",
  store_index_unavailable:
    "The task store index could not be recorded, so no host was opened (store_index_unavailable).",
  host_incompatible:
    "The recorded task host is incompatible; the child was not opened anywhere else (host_incompatible).",
  open_timed_out:
    "The task host did not finish opening the child session in time (open_timed_out).",
  launch_spec_insecure:
    "The task host launch spec is writable by other users or not owned by you, so no task host was started (launch_spec_insecure).",
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
  const { rejected_while: rejectedWhile, exit, launch_spec_path: specPath } = error.failure
  const namedSpec = reason === "launch_spec_insecure" && specPath !== undefined ? homeRelative(specPath) : undefined
  // A reason that is present but outside the closed enum marks the failure as untrusted: nothing
  // beyond the stable classification is derived from it, including its cause.
  const trusted = error.failure.reason === undefined
  const cause = trusted ? causeOf(failureKind, error.failure.cause) : undefined
  const exited = trusted && cause === undefined && rejectedWhile === "exited" ? exit : undefined
  const errorMessage = namedSpec !== undefined
    ? launchSpecInsecureMessage(namedSpec)
    : cause !== undefined
      ? causedMessage(failureKind, cause)
      : exited !== undefined && failureKind === "child-prompt-failed"
        ? `Child prompt failed to start: ${describeChildExit(exited)}.`
        : publicMessage(failureKind, reason)
  return {
    errorMessage,
    failureKind,
    ...(reason === undefined ? {} : { failureReason: reason }),
    eventFacts: {
      failure_kind: failureKind,
      ...(reason === undefined ? {} : { failure_reason: reason }),
      ...(namedSpec === undefined ? {} : { launch_spec_path: namedSpec }),
      ...(rejectedWhile === undefined ? {} : { rejected_while: rejectedWhile }),
      ...(exit === undefined
        ? {}
        : { exit_kind: exit.kind, exit_code: exit.code, exit_signal: exit.signal }),
      ...(cause ?? {}),
    },
  }
}

function causeOf(kind: TaskStartFailureKind, cause: unknown): StartCause | undefined {
  return kind === "child-prompt-failed" || kind === "session_unavailable" ? classifyStartCause(cause) : undefined
}

function causedMessage(kind: TaskStartFailureKind, cause: StartCause): string {
  return kind === "child-prompt-failed"
    ? `Child prompt failed to start: ${describeStartCause(cause, "prompt")}.`
    : `The child session could not be opened: ${describeStartCause(cause, "session")}.`
}

function describeChildExit(exit: NonNullable<RunnerError["failure"]["exit"]>): string {
  const how = exit.signal !== null ? `signal ${exit.signal}` : exit.code !== null ? `code ${exit.code}` : "no exit code"
  return `the child process exited before accepting it (${exit.kind}, ${how})`
}

function homeRelative(path: string): string {
  const home = homedir()
  return home !== "" && path.startsWith(`${home}/`) ? `~${path.slice(home.length)}` : path
}

function launchSpecInsecureMessage(path: string): string {
  return `The task host launch spec is writable by other users or not owned by you, so no task host was started (launch_spec_insecure: ${path}). Fix: run chmod 644 ${path} and make sure the file is yours.`
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
        ? `The task host refused the child session (${reason}).`
        : "The task host could not open the child session."
    case "host_unavailable":
      return reason !== undefined && HOST_UNAVAILABLE_REASONS.has(reason)
        ? `The task host is unavailable (${reason}).`
        : "The task host is unavailable."
    case "child-turn-failed":
      return GENERIC_START_FAILURE_MESSAGE
    case "suspended_unresumable":
      return "The child could not be resumed."
    default:
      return assertNever(kind)
  }
}

function assertNever(value: never): never {
  throw new Error(`Unexpected task start failure kind: ${JSON.stringify(value)}`)
}

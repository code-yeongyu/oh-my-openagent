import { TOOL_CALL_BUDGET_MS, withCallDeadline } from "../../call-budget/call-deadline"
import { controlRefusalOf } from "../control/port"
import { gatewaySchemaRefusal, threadToolFailure, type ThreadToolFailure } from "../errors"
import { refusal } from "../refusal-texts"

export type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }

export function fail(
  code: Parameters<typeof threadToolFailure>[0],
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): Failure {
  return { kind: "error", error: threadToolFailure(code, message, next, details) }
}

/** How a surface words the refusals a thrown failure maps to; the codes, fields and fixed text are the mapping's own. */
export type ThrownWording = {
  readonly hostUnavailable: string
  readonly unsupported: (command: string) => string
  readonly unsupportedNext: string
  readonly unexpectedNext: string
}

/** The thread SDK's and the root's wording. */
const SDK_WORDING: ThrownWording = {
  hostUnavailable: "Retry when a host or terminal session is running.",
  unsupported: (command) => `The target's endpoint does not accept ${command}.`,
  unsupportedNext: "Use thread read to follow the session.",
  unexpectedNext: "Run omo thread list and retry after checking the target.",
}

/**
 * The ONE mapping of a thrown failure on every thread surface (B8): a known typed refusal (a control's own refusal, a
 * gateway schema refusal, a host the surface names unavailable, a command an endpoint does not take) keeps its approved
 * fields; anything else, whatever it is (an Error, its stack and causes, a string, an object), is the fixed failure and
 * reaches only `onUnexpected`.
 */
export function thrown(error: unknown, onUnexpected?: UnexpectedPort, wording: ThrownWording = SDK_WORDING): Failure {
  // A control's typed refusal (another device's answer included) is the call's answer, as in the tools (#14755).
  const refusal = controlRefusalOf(error)
  if (refusal !== undefined) return { kind: "error", error: refusal }
  const schema = gatewaySchemaRefusal(error)
  if (schema !== undefined) return { kind: "error", error: schema }
  // Only an Error the surface raised itself carries one of these prefixes; anything else is unexpected.
  const message = error instanceof Error ? error.message : undefined
  if (message?.startsWith("host_unavailable:"))
    return fail(
      "host_unavailable",
      `The thread host is unavailable at ${message.slice("host_unavailable:".length)}.`,
      wording.hostUnavailable,
    )
  if (message?.startsWith("unsupported:")) {
    const command = message.slice("unsupported:".length)
    return fail("unsupported", wording.unsupported(command), wording.unsupportedNext, { command })
  }
  return unexpectedFailure(error, onUnexpected, wording.unexpectedNext)
}

/** The one fixed text every thread surface answers for an unexpected exception (security ruling B8). */
const UNEXPECTED_FAILURE_MESSAGE = "The thread operation failed unexpectedly."

/**
 * An exception no rule expected: its message and stack go to `onUnexpected` alone, never into the answer (B8: a thrown
 * message can carry a path, a token or another user's text). The tools, the SDK and `omo thread` all answer this.
 */
function unexpectedFailure(
  error: unknown,
  onUnexpected?: UnexpectedPort,
  next = "Run omo thread list and retry after checking the target.",
): Failure {
  const written = reportUnexpected(onUnexpected, error)
  // The fixed text names the local file the port wrote the details to (B8 sink ruling), only when it wrote it, and says so
  // when a port that keeps a file could not write it.
  const message =
    written === undefined
      ? UNEXPECTED_FAILURE_MESSAGE
      : written === false
        ? `${UNEXPECTED_FAILURE_MESSAGE} Its details could not be written to the local log.`
        : `${UNEXPECTED_FAILURE_MESSAGE} The details are in ${written}.`
  return fail("internal_error", message, next)
}

/**
 * Where a surface records an unexpected exception (B8): the only place its text may go. A port that wrote it to a local
 * file answers that file's path, which the fixed message then names; `false` when it keeps a file it could not write.
 */
export type UnexpectedPort = (error: unknown) => unknown

/** Hands an exception to the logger port, isolated from the outcome: a port that throws changes no answer and no receipt. */
export function reportUnexpected(onUnexpected: UnexpectedPort | undefined, error: unknown): string | false | undefined {
  try {
    // Never awaited: a port that hangs holds nothing; one that rejects is caught here, never an unhandled rejection.
    const answered: unknown = onUnexpected?.(error)
    if (answered instanceof Promise) answered.catch(() => undefined)
    if (answered === false) return false
    return typeof answered === "string" && answered !== "" ? answered : undefined
  } catch {
    // The port's own failure is dropped on purpose (reporting it would need the very sink that just failed), and it changes
    // nothing in the answer: only a port that answers `false` says its file could not be written.
    return undefined
  }
}

// omo#14130: every SDK operation runs inside one tool-call budget, as an agent's thread tool call does (tools.ts).
export async function guarded<T>(body: () => Promise<T>, onUnexpected?: UnexpectedPort): Promise<T | Failure> {
  try {
    return await withCallDeadline(Date.now() + TOOL_CALL_BUDGET_MS, body)
  } catch (error) {
    return thrown(error, onUnexpected)
  }
}

/**
 * No leg carries an attachment yet: the gateway delivery on this device has no field for one, and neither has the relay
 * record a send to another device becomes. So a send or a create's first prompt naming attachments (top level or in the
 * object prompt) is refused with this one typed refusal on every surface, before any effect, never sent without them. It sits with the failure helper, one of the three things the
 * root takes across the core's boundary, so the refusal registry stays behind that boundary (P1c decision 7).
 */
export function attachmentsRefused(input: unknown): ThreadToolFailure | undefined {
  const field = (from: unknown, name: string): unknown =>
    typeof from === "object" && from !== null ? Reflect.get(from, name) : undefined
  const attachments = field(input, "attachments") ?? field(field(input, "prompt"), "attachments")
  if (attachments === undefined) return undefined
  const count = Array.isArray(attachments) ? attachments.length : 1
  return refusal("control.send_attachments_unsupported", { count: String(count) }, { field: "attachments", count })
}

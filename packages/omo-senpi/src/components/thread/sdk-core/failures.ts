import { TOOL_CALL_BUDGET_MS, withCallDeadline } from "../../call-budget/call-deadline"
import { controlRefusalOf } from "../control/port"
import { gatewaySchemaRefusal, threadToolFailure, type ThreadToolFailure } from "../errors"

export type Failure = { readonly kind: "error"; readonly error: ThreadToolFailure }

export function fail(
  code: Parameters<typeof threadToolFailure>[0],
  message: string,
  next: string,
  details?: Readonly<Record<string, unknown>>,
): Failure {
  return { kind: "error", error: threadToolFailure(code, message, next, details) }
}

/** The same mapping the tools apply to a thrown surface failure, so a script sees data, never a stack. */
export function thrown(error: unknown): Failure {
  // A control's typed refusal (another device's answer included) is the call's answer, as in the tools (#14755).
  const refusal = controlRefusalOf(error)
  if (refusal !== undefined) return { kind: "error", error: refusal }
  const schema = gatewaySchemaRefusal(error)
  if (schema !== undefined) return { kind: "error", error: schema }
  const message = error instanceof Error ? error.message : String(error)
  if (message.startsWith("host_unavailable:"))
    return fail(
      "host_unavailable",
      `The thread host is unavailable at ${message.slice("host_unavailable:".length)}.`,
      "Retry when a host or terminal session is running.",
    )
  if (message.startsWith("unsupported:"))
    return fail(
      "unsupported",
      `The target's endpoint does not accept ${message.slice("unsupported:".length)}.`,
      "Use thread read to follow the session.",
      { command: message.slice("unsupported:".length) },
    )
  return fail(
    "internal_error",
    `Thread operation failed: ${message}`,
    "Run omo thread list and retry after checking the target.",
  )
}

// omo#14130: every SDK operation runs inside one tool-call budget, as an agent's thread tool call does (tools.ts).
export async function guarded<T>(body: () => Promise<T>): Promise<T | Failure> {
  try {
    return await withCallDeadline(Date.now() + TOOL_CALL_BUDGET_MS, body)
  } catch (error) {
    return thrown(error)
  }
}

export type RecoveryErrorType =
  | "tool_result_missing"
  | "thinking_block_order"
  | "thinking_disabled_violation"
  | "assistant_prefill_unsupported"
  | null

function getErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error.toLowerCase()

  const errorObj = error as Record<string, unknown>
  const paths = [
    errorObj.data,
    errorObj.error,
    errorObj,
    (errorObj.data as Record<string, unknown>)?.error,
  ]

  for (const obj of paths) {
    if (obj && typeof obj === "object") {
      const msg = (obj as Record<string, unknown>).message
      if (typeof msg === "string" && msg.length > 0) {
        return msg.toLowerCase()
      }
    }
  }

  try {
    return JSON.stringify(error).toLowerCase()
  } catch {
    return ""
  }
}

export function extractMessageIndex(error: unknown): number | null {
  const message = getErrorMessage(error)
  const match = message.match(/messages\.(\d+)/)
  return match ? parseInt(match[1], 10) : null
}

export function detectErrorType(error: unknown): RecoveryErrorType {
  const message = getErrorMessage(error)

  if (
    message.includes("assistant message prefill") ||
    message.includes("conversation must end with a user message")
  ) {
    return "assistant_prefill_unsupported"
  }

  if (
    message.includes("thinking") &&
    (message.includes("first block") ||
      message.includes("must start with") ||
      message.includes("preceeding") ||
      message.includes("final block") ||
      message.includes("cannot be thinking") ||
      (message.includes("expected") && message.includes("found")))
  ) {
    return "thinking_block_order"
  }

  if (message.includes("thinking is disabled") && message.includes("cannot contain")) {
    return "thinking_disabled_violation"
  }

  if (message.includes("tool_use") && message.includes("tool_result")) {
    return "tool_result_missing"
  }

  return null
}

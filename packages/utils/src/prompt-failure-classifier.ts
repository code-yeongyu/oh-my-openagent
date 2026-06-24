export function extractPromptFailureMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>
    if (typeof record.message === "string") return record.message
    try {
      return JSON.stringify(error)
    } catch (stringifyError) {
      stringifyError instanceof Error
      return ""
    }
  }
  return String(error)
}

export function isAmbiguousPromptDispatchFailure(error: unknown): boolean {
  const message = extractPromptFailureMessage(error).toLowerCase()
  return (
    message.includes("unexpected eof")
    || message.includes("json parse error")
    || message.includes("unexpected end of json input")
    || message.includes("timed out")
  )
}

type PromptDispatchFailureResultLike = {
  status: "failed"
  error: unknown
  dispatchAttempted?: boolean
}

export function isAmbiguousPostDispatchPromptFailure(result: PromptDispatchFailureResultLike): boolean {
  return result.dispatchAttempted === true && isAmbiguousPromptDispatchFailure(result.error)
}

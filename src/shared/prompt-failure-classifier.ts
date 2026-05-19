export function extractPromptFailureMessage(error: unknown): string {
  if (typeof error === "string") return error
  if (error instanceof Error) return error.message
  if (typeof error === "object" && error !== null) {
    const record = error as Record<string, unknown>
    if (typeof record.message === "string") return record.message
    try {
      return JSON.stringify(error)
    } catch {
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

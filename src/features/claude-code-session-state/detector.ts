export function detectInterrupt(error: unknown): boolean {
  if (!error) return false

  if (typeof error === "object") {
    const errObj = error as Record<string, unknown>
    const name = errObj.name as string | undefined
    const message = errObj.message as string | undefined

    if (name === "MessageAbortedError" || name === "AbortError") return true
    if (name === "DOMException" && message?.includes("abort")) return true
    const msgLower = message?.toLowerCase()
    if (msgLower?.includes("aborted") || msgLower?.includes("cancelled") || msgLower?.includes("interrupted")) return true
  }

  if (typeof error === "string") {
    const lower = error.toLowerCase()
    return lower.includes("abort") || lower.includes("cancel") || lower.includes("interrupt")
  }

  return false
}

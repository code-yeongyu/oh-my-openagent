export function isAbortError(error: unknown): boolean {
  if (!error) return false

  if (typeof error === "object") {
    const errObj = error as Record<string, unknown>
    const name = (errObj.name as string | undefined)?.trim().toLowerCase() ?? ""
    const message = (errObj.message as string | undefined)?.toLowerCase() ?? ""

    if (name === "messageabortederror" || name === "aborterror") return true
    if (name === "domexception" && message.includes("abort")) return true
    if (message.includes("aborted") || message.includes("cancelled") || message.includes("canceled") || message.includes("interrupted")) return true
  }

  if (typeof error === "string") {
    const lower = error.toLowerCase()
    return lower.includes("abort") || lower.includes("cancel") || lower.includes("interrupt")
  }

  return false
}

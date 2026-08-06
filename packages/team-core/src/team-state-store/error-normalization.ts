export function toError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}

function extractErrorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message
  if (typeof error === "string") return error
  if (typeof error !== "object" || error === null || !("message" in error)) return undefined
  return typeof error.message === "string" ? error.message : undefined
}

function extractErrorStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null || !("status" in error)) return undefined
  return typeof error.status === "number" ? error.status : undefined
}

export function isSessionNotFoundError(error: unknown): boolean {
  if (extractErrorStatus(error) === 404) return true
  const message = extractErrorMessage(error)?.toLowerCase()
  if (!message) return false
  return message.includes("not found") || message.includes("missing")
}

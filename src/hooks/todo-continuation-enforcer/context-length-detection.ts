const CONTEXT_LENGTH_PATTERNS = [
  "prompt is too long",
  "context_length_exceeded",
  "ContextLengthError",
  "ContextOverflowError",
  "maximum context length",
  "token limit",
  "exceeds the model's maximum",
  "input is too long",
  "max_tokens",
]

function extractErrorString(error: unknown): string {
  if (typeof error === "string") return error
  if (error === null || error === undefined) return ""

  const obj = error as Record<string, unknown>
  const parts: string[] = []

  if (typeof obj.name === "string") parts.push(obj.name)
  if (typeof obj.message === "string") parts.push(obj.message)
  if (typeof obj.error === "string") parts.push(obj.error)

  // OpenCode SDK wraps errors in error.data or error.error
  if (typeof obj.data === "object" && obj.data !== null) {
    const data = obj.data as Record<string, unknown>
    if (typeof data.message === "string") parts.push(data.message)
    if (typeof data.error === "string") {
      parts.push(data.error)
    } else if (typeof data.error === "object" && data.error !== null) {
      const nestedError = data.error as Record<string, unknown>
      if (typeof nestedError.message === "string") parts.push(nestedError.message)
      if (typeof nestedError.code === "string") parts.push(nestedError.code)
      if (typeof nestedError.type === "string") parts.push(nestedError.type)
    }
    if (typeof data.type === "string") parts.push(data.type)
  }

  if (typeof obj.error === "object" && obj.error !== null) {
    const nested = obj.error as Record<string, unknown>
    if (typeof nested.message === "string") parts.push(nested.message)
    if (typeof nested.type === "string") parts.push(nested.type)
  }

  return parts.join(" ")
}

export function isContextLengthError(error: unknown): boolean {
  const errorStr = extractErrorString(error).toLowerCase()
  if (!errorStr) return false

  return CONTEXT_LENGTH_PATTERNS.some((pattern) => errorStr.includes(pattern.toLowerCase()))
}

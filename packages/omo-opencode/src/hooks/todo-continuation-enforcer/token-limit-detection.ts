import { isRetryableModelError } from "../../shared/model-error-classifier"

const TOKEN_LIMIT_FALLBACK_PATTERNS = [
  "prompt is too long",
  "is too long",
  "context_length_exceeded",
  "token limit",
  "context length",
  "too many tokens",
]

const TOKEN_LIMIT_ERROR_NAMES = new Set([
  "contextlengtherror",
  "context_length_exceeded",
])

export function isTokenLimitError(error: { name?: string; message?: string } | undefined): boolean {
  if (!error) return false

  const isRetryable = isRetryableModelError({
    name: error.name,
    message: error.message,
  })

  if (!isRetryable && error.name) {
    const errorNameLower = error.name.toLowerCase()
    if (TOKEN_LIMIT_ERROR_NAMES.has(errorNameLower)) {
      return true
    }
  }

  if (error.message) {
    const lower = error.message.toLowerCase()
    return TOKEN_LIMIT_FALLBACK_PATTERNS.some((pattern) => lower.includes(pattern))
  }

  return false
}

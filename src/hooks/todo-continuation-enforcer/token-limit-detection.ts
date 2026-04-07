const TOKEN_LIMIT_ERROR_NAMES = new Set([
  "contextlengtherror",
])

const TOKEN_LIMIT_KEYWORDS = [
  "prompt is too long",
  "is too long",
  "context_length_exceeded",
  "token limit",
  "context length",
  "too many tokens",
]

export function isTokenLimitError(error: { name?: string; message?: string } | undefined): boolean {
  if (!error) return false

  if (error.name && TOKEN_LIMIT_ERROR_NAMES.has(error.name.toLowerCase())) {
    return true
  }

  if (error.message) {
    const lower = error.message.toLowerCase()
    return TOKEN_LIMIT_KEYWORDS.some((keyword) => lower.includes(keyword))
  }

  return false
}

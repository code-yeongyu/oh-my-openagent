// Redacts sensitive tokens from error messages to prevent credential exposure
// Follows same patterns as env-cleaner.ts for consistency

const SENSITIVE_PATTERNS: RegExp[] = [
  // API keys and tokens in common formats
  /[a-zA-Z0-9_-]*(?:api[_-]?key|apikey)["\s]*[:=]["\s]*([a-zA-Z0-9_-]{16,})/gi,
  /[a-zA-Z0-9_-]*(?:auth[_-]?token|authtoken)["\s]*[:=]["\s]*([a-zA-Z0-9_-]{16,})/gi,
  /[a-zA-Z0-9_-]*(?:access[_-]?token|accesstoken)["\s]*[:=]["\s]*([a-zA-Z0-9_-]{16,})/gi,
  /[a-zA-Z0-9_-]*(?:secret)["\s]*[:=]["\s]*([a-zA-Z0-9_-]{16,})/gi,
  /[a-zA-Z0-9_-]*(?:password)["\s]*[:=]["\s]*([a-zA-Z0-9_-]{8,})/gi,

  // Bearer tokens
  /bearer\s+([a-zA-Z0-9_-]{20,})/gi,

  // Common token prefixes
  /sk-[a-zA-Z0-9]{20,}/g, // OpenAI-style secret keys
  /gh[pousr]_[a-zA-Z0-9]{20,}/gi, // GitHub tokens
  /glpat-[a-zA-Z0-9_-]{20,}/gi, // GitLab tokens
  /[A-Za-z0-9_]{20,}-[A-Za-z0-9_]{10,}-[A-Za-z0-9_]{10,}/g, // Common JWT-like patterns
]

const REDACTION_MARKER = "[REDACTED]"

/**
 * Redacts sensitive tokens from a string.
 * Used for error messages that may contain command-line arguments or environment info.
 */
export function redactSensitiveData(input: string): string {
  let result = input

  for (const pattern of SENSITIVE_PATTERNS) {
    result = result.replace(pattern, REDACTION_MARKER)
  }

  return result
}

/**
 * Redacts sensitive data from an Error object, returning a new Error.
 * Preserves the stack trace but redacts the message.
 */
export function redactErrorSensitiveData(error: Error): Error {
  const redactedMessage = redactSensitiveData(error.message)
  const redactedError = new Error(redactedMessage)
  redactedError.stack = error.stack ? redactSensitiveData(error.stack) : undefined
  return redactedError
}

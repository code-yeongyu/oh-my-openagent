import { redactSecretText } from "./secret-text"

const redactedValue = "[REDACTED]"
// Fields that carry provider error text, which can echo credentials (#11355).
const errorTextKeyPattern = /^(?:error|error_message|last_error|message)$/
const sensitiveKeyPattern = /token|password|secret|authorization|api[_-]?key/i

export function redactEventPayload(value: unknown): unknown {
  if (Array.isArray(value)) return value.map((entry) => redactEventPayload(entry))
  if (!isPlainRecord(value)) return value

  const redacted: Record<string, unknown> = {}
  for (const [key, entry] of Object.entries(value)) {
    redacted[key] = sensitiveKeyPattern.test(key)
      ? redactedValue
      : typeof entry === "string" && errorTextKeyPattern.test(key)
        ? redactSecretText(entry)
        : redactEventPayload(entry)
  }
  return redacted
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
}

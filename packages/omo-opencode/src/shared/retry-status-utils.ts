export function normalizeRetryStatusMessage(message: string): string {
  return message
    .replace(/\[retrying in [^\]]*attempt\s*#\d+\]/gi, "[retrying]")
    .replace(/retrying in\s+[^(]*attempt\s*#\d+/gi, "retrying")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase()
}

export function extractRetryAttempt(statusAttempt: unknown, message: string): string {
  if (typeof statusAttempt === "number" && Number.isFinite(statusAttempt)) {
    return String(statusAttempt)
  }
  const attemptMatch = message.match(/attempt\s*#\s*(\d+)/i)
  if (attemptMatch?.[1]) {
    return attemptMatch[1]
  }
  return "?"
}

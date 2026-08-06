const SDK_UNAVAILABLE_PATTERNS = [
  "unable to connect",
  "econnrefused",
  "fetch failed",
  "network error",
  "network request failed",
  "server unreachable",
  "etimedout",
  "timed out",
  "timeout",
  "socket hang up",
] as const

function collectErrorTexts(value: unknown): string[] {
  if (value instanceof Error) {
    return [value.message, value.name, ...collectErrorTexts(value.cause)]
  }

  if (typeof value === "string") {
    return [value]
  }

  if (!value || typeof value !== "object") {
    return []
  }

  const record = value as Record<string, unknown>
  return [
    typeof record.message === "string" ? record.message : "",
    typeof record.code === "string" ? record.code : "",
    typeof record.name === "string" ? record.name : "",
    ...collectErrorTexts(record.cause),
    ...collectErrorTexts(record.error),
  ].filter(Boolean)
}

export function isSessionSdkUnavailableError(value: unknown): boolean {
  const haystack = collectErrorTexts(value)
    .join(" ")
    .toLowerCase()

  return SDK_UNAVAILABLE_PATTERNS.some((pattern) => haystack.includes(pattern))
}

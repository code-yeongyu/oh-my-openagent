import { DEFAULT_CONFIG, RETRYABLE_ERROR_PATTERNS } from "./constants"

export { extractAutoRetrySignal } from "./auto-retry-signal"

export function getErrorMessage(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error.toLowerCase()

  const errorObj = error as Record<string, unknown>
  const paths = [
    errorObj.data,
    errorObj.error,
    errorObj,
    (errorObj.data as Record<string, unknown>)?.error,
  ]

  for (const obj of paths) {
    if (obj && typeof obj === "object") {
      const msg = (obj as Record<string, unknown>).message
      if (typeof msg === "string" && msg.length > 0) {
        return msg.toLowerCase()
      }
    }
  }

  const errorObj2 = error as Record<string, unknown>
  const name = errorObj2.name
  if (typeof name === "string" && name.length > 0) {
    const nameColonMatch = name.match(/:\s*(.+)/)
    if (nameColonMatch) return nameColonMatch[1].trim().toLowerCase()
  }

  try {
    return JSON.stringify(error).toLowerCase()
  } catch {
    return ""
  }
}

const DEFAULT_RETRY_PATTERN = new RegExp(`\\b(${DEFAULT_CONFIG.retry_on_errors.join("|")})\\b`)

export function extractStatusCode(error: unknown, retryOnErrors?: number[]): number | undefined {
  if (!error) return undefined

  const errorObj = error as Record<string, unknown>

  const statusCode = [
    errorObj.statusCode,
    errorObj.status,
    (errorObj.data as Record<string, unknown>)?.statusCode,
    (errorObj.error as Record<string, unknown>)?.statusCode,
    (errorObj.cause as Record<string, unknown>)?.statusCode,
  ].find((code): code is number => typeof code === "number")

  if (statusCode !== undefined) {
    return statusCode
  }

  const pattern = retryOnErrors 
    ? new RegExp(`\\b(${retryOnErrors.join("|")})\\b`)
    : DEFAULT_RETRY_PATTERN
  const message = getErrorMessage(error)
  const statusMatch = message.match(pattern)
  if (statusMatch) {
    return parseInt(statusMatch[1], 10)
  }

  return undefined
}

export function extractErrorName(error: unknown): string | undefined {
  if (!error || typeof error !== "object") return undefined

  const errorObj = error as Record<string, unknown>
  const directName = errorObj.name
  if (typeof directName === "string" && directName.length > 0) {
    return directName
  }

  const dataName = (errorObj.data as Record<string, unknown> | undefined)?.name
  if (typeof dataName === "string" && dataName.length > 0) {
    return dataName
  }

  const nestedError = errorObj.error as Record<string, unknown> | undefined
  const nestedName = nestedError?.name
  if (typeof nestedName === "string" && nestedName.length > 0) {
    return nestedName
  }

  const dataError = (errorObj.data as Record<string, unknown> | undefined)?.error as Record<string, unknown> | undefined
  const dataErrorName = dataError?.name
  if (typeof dataErrorName === "string" && dataErrorName.length > 0) {
    return dataErrorName
  }

  return undefined
}

export function classifyErrorType(error: unknown): string | undefined {
  const message = getErrorMessage(error)
  const errorName = extractErrorName(error)?.toLowerCase()

  if (
    errorName?.includes("ai_loadapikeyerror") ||
    errorName?.includes("loadapi") ||
    (/api.?key.?is.?missing/i.test(message) && /environment variable/i.test(message))
  ) {
    return "missing_api_key"
  }

  if (/api.?key/i.test(message) && /must be a string/i.test(message)) {
    return "invalid_api_key"
  }

  if (
    errorName?.includes("providermodelnotfounderror") ||
    errorName?.includes("modelnotfounderror") ||
    (errorName?.includes("unknownerror") && /model\s+not\s+found/i.test(message))
  ) {
    return "model_not_found"
  }

  if (
    errorName?.includes("quotaexceeded") ||
    errorName?.includes("insufficientquota") ||
    errorName?.includes("billingerror") ||
    /quota.?exceeded/i.test(message) ||
    /subscription.*quota/i.test(message) ||
    /insufficient.?quota/i.test(message) ||
    /billing.?(?:hard.?)?limit/i.test(message) ||
    /exhausted\s+your\s+capacity/i.test(message) ||
    /out\s+of\s+credits?/i.test(message) ||
    /payment.?required/i.test(message) ||
    /usage\s+limit/i.test(message)
  ) {
    return "quota_exceeded"
  }

  return undefined
}

export function containsErrorContent(
  parts: Array<{ type?: string; text?: string }> | undefined
): { hasError: boolean; errorMessage?: string } {
  if (!parts || parts.length === 0) return { hasError: false }

  const errorParts = parts.filter((p) => p.type === "error")
  if (errorParts.length > 0) {
    const errorMessages = errorParts.map((p) => p.text).filter((text): text is string => typeof text === "string")
    const errorMessage = errorMessages.length > 0 ? errorMessages.join("\n") : undefined
    return { hasError: true, errorMessage }
  }

  return { hasError: false }
}

export function isRetryableError(error: unknown, retryOnErrors: number[]): boolean {
  const statusCode = extractStatusCode(error, retryOnErrors)
  const message = getErrorMessage(error)
  const errorType = classifyErrorType(error)

  if (errorType === "missing_api_key") {
    return true
  }

  if (errorType === "model_not_found") {
    return true
  }

  if (errorType === "quota_exceeded") {
    // When a provider signals an auto-retry (e.g. "retrying in ~2 weeks"),
    // we should still trigger fallback to another model rather than STOP.
    const hasAutoRetrySignal = /retrying\s+in/i.test(message)
    return hasAutoRetrySignal
  }

  if (statusCode && retryOnErrors.includes(statusCode)) {
    return true
  }

  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

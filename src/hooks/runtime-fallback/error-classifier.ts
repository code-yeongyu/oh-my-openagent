import { DEFAULT_CONFIG, RETRYABLE_ERROR_PATTERNS } from "./constants"

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

  try {
    return JSON.stringify(error).toLowerCase()
  } catch {
    return ""
  }
}

export function extractStatusCode(error: unknown, retryOnErrors?: number[]): number | undefined {
  if (!error) return undefined

  const errorObj = error as Record<string, unknown>

  const statusCode = errorObj.statusCode ?? errorObj.status ?? (errorObj.data as Record<string, unknown>)?.statusCode
  if (typeof statusCode === "number") {
    return statusCode
  }

  const codes = retryOnErrors ?? DEFAULT_CONFIG.retry_on_errors
  const pattern = new RegExp(`\\b(${codes.join("|")})\\b`)
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
    errorName?.includes("loadapi") ||
    (/api.?key.?is.?missing/i.test(message) && /environment variable/i.test(message))
  ) {
    return "missing_api_key"
  }

  if (/api.?key/i.test(message) && /must be a string/i.test(message)) {
    return "invalid_api_key"
  }

  if (errorName?.includes("unknownerror") && /model\s+not\s+found/i.test(message)) {
    return "model_not_found"
  }

  return undefined
}

export interface AutoRetrySignal {
  signal: string
}

export const AUTO_RETRY_PATTERNS: Array<(combined: string) => boolean> = [
  (combined) => /retrying\s+in/i.test(combined),
  (combined) =>
    /(?:too\s+many\s+requests|quota\s*exceeded|usage\s+limit|rate\s+limit|limit\s+reached)/i.test(combined),
]

export function extractAutoRetrySignal(info: Record<string, unknown> | undefined): AutoRetrySignal | undefined {
  if (!info) return undefined

  const candidates: string[] = []

  const directStatus = info.status
  if (typeof directStatus === "string") candidates.push(directStatus)

  const summary = info.summary
  if (typeof summary === "string") candidates.push(summary)

  const message = info.message
  if (typeof message === "string") candidates.push(message)

  const details = info.details
  if (typeof details === "string") candidates.push(details)

  const combined = candidates.join("\n")
  if (!combined) return undefined

  const isAutoRetry = AUTO_RETRY_PATTERNS.every((test) => test(combined))
  if (isAutoRetry) {
    return { signal: combined }
  }

  return undefined
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

  if (statusCode && retryOnErrors.includes(statusCode)) {
    return true
  }

  return RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

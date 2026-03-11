import { AUTO_RETRY_SIGNAL_KEYWORD_PATTERNS, DEFAULT_CONFIG, RETRYABLE_ERROR_PATTERNS } from "./constants"

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

function compilePatterns(patterns: string[]): RegExp[] {
  const compiled: RegExp[] = []
  for (const pattern of patterns) {
    try {
      compiled.push(new RegExp(pattern, "i"))
    } catch {
      continue
    }
  }
  return compiled
}

function resolveAutoRetryKeywordPatterns(retryOnMessagePatterns: string[] = []): RegExp[] {
  return compilePatterns([...AUTO_RETRY_SIGNAL_KEYWORD_PATTERNS, ...retryOnMessagePatterns])
}

function resolveRetryableMessagePatterns(retryOnMessagePatterns: string[] = []): RegExp[] {
  return [...RETRYABLE_ERROR_PATTERNS, ...compilePatterns(retryOnMessagePatterns)]
}

export function extractAutoRetrySignal(
  info: Record<string, unknown> | undefined,
  retryOnMessagePatterns: string[] = []
): AutoRetrySignal | undefined {
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

  const autoRetryPatterns: Array<(combined: string) => boolean> = [
    (text) => /retrying\s+in/i.test(text),
    (text) => resolveAutoRetryKeywordPatterns(retryOnMessagePatterns).some((pattern) => pattern.test(text)),
  ]

  const isAutoRetry = autoRetryPatterns.every((test) => test(combined))
  if (isAutoRetry) {
    return { signal: combined }
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

export function isRetryableError(
  error: unknown,
  retryOnErrors: number[],
  retryOnMessagePatterns: string[] = []
): boolean {
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

  return resolveRetryableMessagePatterns(retryOnMessagePatterns).some((pattern) => pattern.test(message))
}

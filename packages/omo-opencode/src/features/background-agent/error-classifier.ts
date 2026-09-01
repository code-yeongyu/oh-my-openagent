import { isRecord } from "@oh-my-opencode/utils"
export { isRecord }

export function isAbortedSessionError(error: unknown): boolean {
  const message = getErrorText(error)
  return message.toLowerCase().includes("aborted")
}

export function getErrorText(error: unknown): string {
  if (!error) return ""
  if (typeof error === "string") return error
  if (error instanceof Error) {
    return `${error.name}: ${error.message}`
  }
  if (typeof error === "object" && error !== null) {
    if ("message" in error && typeof error.message === "string") {
      return error.message
    }
    if ("name" in error && typeof error.name === "string") {
      return error.name
    }
  }
  return ""
}

export function extractErrorName(error: unknown): string | undefined {
  if (isRecord(error) && typeof error["name"] === "string") return error["name"]
  if (error instanceof Error) return error.name
  return undefined
}

export function extractErrorMessage(error: unknown): string | undefined {
  if (!error) return undefined
  if (typeof error === "string") return error

  if (isRecord(error)) {
    const dataRaw = error["data"]
    const candidates: unknown[] = [
      dataRaw,
      isRecord(dataRaw) ? (dataRaw as Record<string, unknown>)["error"] : undefined,
      error["error"],
      error["cause"],
      error,
    ]

    for (const candidate of candidates) {
      if (typeof candidate === "string" && candidate.length > 0) return candidate
      if (
        isRecord(candidate) &&
        typeof candidate["message"] === "string" &&
        candidate["message"].length > 0
      ) {
        return candidate["message"]
      }
    }
  }

  if (error instanceof Error) return error.message

  try {
    return JSON.stringify(error)
  } catch (stringifyError) {
    if (stringifyError instanceof Error) return String(error)
    return String(error)
  }
}

export function extractErrorStatusCode(error: unknown): number | undefined {
  if (!isRecord(error)) return undefined

  for (const key of ["statusCode", "status", "code"]) {
    const val = (error as Record<string, unknown>)[key]
    if (typeof val === "number" && val >= 100 && val < 600) return val
  }

  const statusVal = (error as Record<string, unknown>)["status"]
  if (typeof statusVal === "string") {
    const parsed = parseInt(statusVal, 10)
    if (parsed >= 100 && parsed < 600) return parsed
  }

  const responseRaw = (error as Record<string, unknown>)["response"]
  if (isRecord(responseRaw)) {
    const respStatus = responseRaw["status"]
    if (typeof respStatus === "number" && respStatus >= 100 && respStatus < 600) return respStatus
    if (typeof respStatus === "string") {
      const parsed = parseInt(respStatus, 10)
      if (parsed >= 100 && parsed < 600) return parsed
    }
  }

  return undefined
}

interface EventPropertiesLike {
  [key: string]: unknown
}

export function getSessionErrorMessage(properties: EventPropertiesLike): string | undefined {
  const errorRaw = properties["error"]
  if (!isRecord(errorRaw)) return undefined

  const dataRaw = errorRaw["data"]
  if (isRecord(dataRaw)) {
    const message = dataRaw["message"]
    if (typeof message === "string") return message

    const nestedError = dataRaw["error"]
    if (isRecord(nestedError)) {
      const nestedMessage = nestedError["message"]
      if (typeof nestedMessage === "string") return nestedMessage

      const nestedType = nestedError["type"]
      if (typeof nestedType === "string") return nestedType
    }
  }

  const message = errorRaw["message"]
  return typeof message === "string" ? message : undefined
}

/**
 * Terminal session errors that mean a background subagent will NEVER produce
 * output, regardless of how long we wait. The session shell may still exist
 * on disk (so `verifySessionExists` returns true), but no future `session.idle`
 * will ever complete it. The parent session must be notified instead of
 * waiting forever (issue #5971).
 *
 * Kept deliberately narrow: transient patterns (503, timeout, "try again",
 * "temporarily unavailable", rate limits) are NOT here because those may
 * still recover via `session.idle` or OpenCode's own transport retries.
 */
const TERMINAL_SESSION_ERROR_PATTERNS: readonly RegExp[] = [
  /no provider available/i,
  /provider not (available|found|configured)/i,
  /provider is forbidden/i,
  /selected provider is forbidden/i,
  /unknown provider/i,
  /model not supported/i,
  /model_not_supported/i,
  /model[_\s-]*not[_\s-]*found/i,
  /(?:no|missing)[_\s-]*(?:api|auth(?:entication)?)[_\s-]*key/i,
  /(?:api|auth(?:entication)?)[_\s-]*key(?:[_\s-]+is)?[_\s-]*(?:missing|not[_\s-]*(?:found|configured)|required)/i,
  /no models available/i,
  /no connected providers/i,
  /all providers (?:are )?(?:unavailable|disconnected|exhausted)/i,
]

export function isTerminalSessionError(
  errorInfo: { name?: string; message?: string; statusCode?: number },
): boolean {
  const text = [
    errorInfo?.name,
    errorInfo?.message,
  ]
    .filter((value): value is string => typeof value === "string" && value.length > 0)
    .join(" ")
  if (text.length === 0) return false
  return TERMINAL_SESSION_ERROR_PATTERNS.some((pattern) => pattern.test(text))
}

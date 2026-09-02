export {
  extractRuntimeFallbackAutoRetrySignal,
  type RuntimeFallbackAutoRetrySignal,
} from "./runtime-fallback-auto-retry-signal"
export { RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS } from "./runtime-fallback-retryable-patterns"
export {
  getRuntimeFallbackErrorMessage,
  getRuntimeFallbackErrorName,
  getRuntimeFallbackRetryableSignal,
  getRuntimeFallbackStatusCode,
} from "./runtime-fallback-error-shape"

import {
  getRuntimeFallbackErrorMessage,
  getRuntimeFallbackErrorName,
  getRuntimeFallbackRetryableSignal,
  getRuntimeFallbackStatusCode,
} from "./runtime-fallback-error-shape"
import { RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS } from "./runtime-fallback-retryable-patterns"

export type RuntimeFallbackErrorType =
  | "missing_api_key"
  | "invalid_api_key"
  | "model_not_found"
  | "quota_exceeded"
  | "context_overflow"
  | "abort"

export interface RuntimeFallbackRetryOptions {
  onUnsafeRetryableSignalRejected?: (details: {
    readonly statusCode: number
    readonly retryOnErrors: readonly number[]
  }) => void
}

type UnknownRecord = Readonly<Record<string, unknown>>

function isStatusCodeRetrySafe(code: number, retryOnErrors: readonly number[]): boolean {
  return retryOnErrors.includes(code) || (code >= 500 && code < 600) || code === 408 || code === 425 || code === 429
}

function isLocalizedQuotaExhaustionMessage(message: string): boolean {
  return (
    (/预扣费额度失败/i.test(message) && /用户剩余额度/i.test(message)) ||
    (/用户剩余额度/i.test(message) && /需要预扣费额度/i.test(message))
  )
}

function isUnknownRecord(value: unknown): value is UnknownRecord {
  return typeof value === "object" && value !== null
}

function getUnknownProperty(value: unknown, key: string): unknown {
  if (!isUnknownRecord(value)) return undefined
  try {
    return value[key]
  } catch (cause) {
    // Unknown inputs may use hostile Proxy traps, so property-read failures cannot escape this boundary.
    if (!(cause instanceof Error)) {
      void cause
    }
    return undefined
  }
}

function getDetailErrorType(error: unknown): string | undefined {
  const data = getUnknownProperty(error, "data")
  const detail = getUnknownProperty(error, "detail") ?? getUnknownProperty(data, "detail") ?? error
  const detailError = getUnknownProperty(detail, "error") ?? detail
  const type = getUnknownProperty(detailError, "type") ?? getUnknownProperty(detail, "type")
  return typeof type === "string" ? type.toLowerCase() : undefined
}

function isTerminalQuotaMessage(message: string): boolean {
  if (
    /\bnon[-\s]+terminal\s+quota\b/i.test(message) ||
    /\bnon[-\s]+terminal\s+billing\s+limit\b/i.test(message)
  ) {
    return false
  }
  return (
    /\bterminal\s+quota\b/i.test(message) ||
    /\bterminal\s+billing\s+limit\b/i.test(message) ||
    /\bhard\s+billing\s+limit\b/i.test(message)
  )
}

export function classifyRuntimeFallbackError(error: unknown): RuntimeFallbackErrorType | undefined {
  const detailType = getDetailErrorType(error)
  if (detailType === "terminal_quota_exhausted") {
    return "abort"
  }

  const message = getRuntimeFallbackErrorMessage(error)
  if (isTerminalQuotaMessage(message)) {
    return "abort"
  }

  const errorName = getRuntimeFallbackErrorName(error)?.toLowerCase().replace(/[_-]/g, "")

  if (errorName?.includes("messageabortederror") || errorName?.includes("aborterror")) {
    return "abort"
  }

  if (errorName === "contextoverflowerror") {
    return "context_overflow"
  }

  if (
    errorName?.includes("ailoadapikeyerror") ||
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
    errorName?.includes("resourceexhausted") ||
    /quota.?exceeded/i.test(message) ||
    /exceeded.*quota/i.test(message) ||
    /usage\s*quota/i.test(message) ||
    /subscription.?(?:quota|limit)/i.test(message) ||
    /insufficient.?(?:quota|balance|funds?)/i.test(message) ||
    /billing.?(?:hard.?)?limit/i.test(message) ||
    /exhausted\s+your\s+capacity/i.test(message) ||
    /resource.?exhausted/i.test(message) ||
    /out\s+of\s+credits?/i.test(message) ||
    /payment.?required/i.test(message) ||
    /usage\s+limit/i.test(message) ||
    /credit\s+balance.*too\s+low/i.test(message) ||
    /limit\s+exhausted/i.test(message) ||
    /使用上限/.test(message) ||
    /达到.*限制/.test(message) ||
    /额度.*不足/.test(message) ||
    /余额.*不足/.test(message) ||
    /已耗尽/.test(message) ||
    isLocalizedQuotaExhaustionMessage(message)
  ) {
    return "quota_exceeded"
  }

  return undefined
}

export function isRuntimeFallbackRetryableError(
  error: unknown,
  retryOnErrors: readonly number[],
  options: RuntimeFallbackRetryOptions = {},
): boolean {
  const statusCode = getRuntimeFallbackStatusCode(error, retryOnErrors)
  const message = getRuntimeFallbackErrorMessage(error)
  const errorType = classifyRuntimeFallbackError(error)

  // OpenCode starts native compaction for this error; fallback would abort that compaction on its timeout.
  if (errorType === "abort" || errorType === "context_overflow") return false

  if (
    errorType === "missing_api_key" ||
    errorType === "model_not_found" ||
    errorType === "quota_exceeded"
  ) {
    return true
  }

  if (statusCode && retryOnErrors.includes(statusCode)) {
    return true
  }

  const retryableSignal = getRuntimeFallbackRetryableSignal(error)
  if (retryableSignal === true) {
    if (statusCode === undefined || isStatusCodeRetrySafe(statusCode, retryOnErrors)) {
      return true
    }

    options.onUnsafeRetryableSignalRejected?.({ statusCode, retryOnErrors })
  }

  return RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS.some((pattern) => pattern.test(message))
}

export {
  extractRuntimeFallbackAutoRetrySignal,
  type RuntimeFallbackAutoRetrySignal,
} from "./runtime-fallback-auto-retry-signal"
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

export type RuntimeFallbackErrorType =
  | "missing_api_key"
  | "invalid_api_key"
  | "model_not_found"
  | "quota_exceeded"
  | "abort"

export const RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS = [
  /rate.?limit/i,
  /too.?many.?requests/i,
  /quota\s+will\s+reset\s+after/i,
  /quota.?exceeded/i,
  /exceeded.*quota/i,
  /usage\s*quota/i,
  /exhausted\s+your\s+capacity/i,
  /limit\s+exhausted/i,
  /all\s+credentials\s+for\s+model/i,
  /cool(?:ing)?\s+down/i,
  /model.{0,20}?not.{0,10}?supported/i,
  /model_not_supported/i,
  /service.?unavailable/i,
  /overloaded/i,
  /temporarily.?unavailable/i,
  /try.?again/i,
  /(?:^|\s)429(?:\s|$)/,
  /(?:^|\s)503(?:\s|$)/,
  /(?:^|\s)529(?:\s|$)/,
  /使用上限/,
  /频率限制/,
  /请求过于频繁/,
  /暂时不可用/,
  /服务不可用/,
  /请稍后重试/,
] as const

export interface RuntimeFallbackRetryOptions {
  onUnsafeRetryableSignalRejected?: (details: {
    readonly statusCode: number
    readonly retryOnErrors: readonly number[]
  }) => void
}

function isStatusCodeRetrySafe(code: number, retryOnErrors: readonly number[]): boolean {
  return retryOnErrors.includes(code) || (code >= 500 && code < 600) || code === 408 || code === 425 || code === 429
}

function isLocalizedQuotaExhaustionMessage(message: string): boolean {
  return (
    (/预扣费额度失败/i.test(message) && /用户剩余额度/i.test(message)) ||
    (/用户剩余额度/i.test(message) && /需要预扣费额度/i.test(message))
  )
}

export function classifyRuntimeFallbackError(error: unknown): RuntimeFallbackErrorType | undefined {
  const message = getRuntimeFallbackErrorMessage(error)
  const errorName = getRuntimeFallbackErrorName(error)?.toLowerCase().replace(/[_-]/g, "")

  if (errorName?.includes("messageabortederror") || errorName?.includes("aborterror")) {
    return "abort"
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
    /subscription.*quota/i.test(message) ||
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

  if (errorType === "abort") return false

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

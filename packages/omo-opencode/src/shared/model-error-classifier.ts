import {
  getNextFallback,
  hasMoreFallbacks,
  isRetryableModelError,
  selectFallbackProviderWithCache,
  shouldRetryError,
} from "@oh-my-opencode/model-core"
import type { ErrorInfo } from "@oh-my-opencode/model-core"
import * as connectedProvidersCache from "./connected-providers-cache"

export type { ErrorInfo }
export {
  isRetryableModelError,
  shouldRetryError,
  getNextFallback,
  hasMoreFallbacks,
  selectFallbackProviderWithCache,
}

/**
 * Error names that indicate a retryable model error (deadstop).
 * These errors completely halt the action loop and should trigger fallback retry.
 */
const RETRYABLE_ERROR_NAMES = new Set([
  "providermodelnotfounderror",
  "ratelimiterror",
  "quotaexceedederror",
  "insufficientcreditserror",
  "modelunavailableerror",
  "providerconnectionerror",
  "authenticationerror",
  "freeusagelimiterror",
  "modelnotsupportederror",
])

/**
 * Error names that should NOT trigger retry.
 * These errors are typically user-induced or fixable without switching models.
 */
const NON_RETRYABLE_ERROR_NAMES = new Set([
  "messageabortederror",
  "permissiondeniederror",
  "contextlengtherror",
  "timeouterror",
  "validationerror",
  "syntaxerror",
  "usererror",
])

/**
 * Message patterns that indicate a retryable error even without a known error name.
 */
const RETRYABLE_MESSAGE_PATTERNS = [
  "rate_limit",
  "rate limit",
  "quota",
  "quota will reset after",
  "usage limit has been reached",
  "all credentials for model",
  "cooling down",
  "exhausted your capacity",
  "not found",
  "unavailable",
  "insufficient",
  "too many requests",
  "over limit",
  "overloaded",
  "bad gateway",
  "unknown provider",
  "provider not found",
  "connection error",
  "network error",
  "timeout",
  "service unavailable",
  "internal_server_error",
  "free usage",
  "usage exceeded",
  "credit",
  "balance",
  "temporarily unavailable",
  "try again",
  "503",
  "model_not_supported",
  "model is not supported",
  "model not supported",
  "502",
  "504",
  "429",
  "529",
]

const AUTO_RETRY_GATE_PATTERNS = [
  "rate limit",
  "quota",
  "usage limit",
  "limit reached",
  "cooling down",
  "credentials for model",
  "exhausted your capacity",
]

function hasProviderAutoRetrySignal(message: string): boolean {
  if (!message.includes("retrying in")) {
    return false
  }
  return AUTO_RETRY_GATE_PATTERNS.some((pattern) => message.includes(pattern))
}

export function selectFallbackProvider(
  providers: string[],
  preferredProviderID?: string,
): string {
  return selectFallbackProviderWithCache(
    providers,
    connectedProvidersCache,
    preferredProviderID,
  )
}

import type { FallbackEntry } from "./model-requirements"
import { readConnectedProvidersCache } from "./connected-providers-cache"

/**
 * Error names that indicate a retryable model error (deadstop).
 * These errors completely halt the action loop and should trigger fallback retry.
 */
const RETRYABLE_ERROR_NAMES = new Set([
  "providermodelnotfounderror",
  "ratelimiterror",
  "modelunavailableerror",
  "providerconnectionerror",
  "authenticationerror",
])

const STOP_ERROR_NAMES = new Set([
  "quotaexceedederror",
  "insufficientcreditserror",
  "freeusagelimiterror",
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
  "bad request",
  "unknown provider",
  "provider not found",
  "model_not_supported",
  "model not supported",
  "model is not supported",
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

export interface ErrorInfo {
  name?: string
  message?: string
}

/**
 * Determines if an error is a retryable model error.
 * Returns true if the error is a known retryable type OR matches retryable message patterns.
 */
export function isRetryableModelError(error: ErrorInfo): boolean {
  // If we have an error name, check against known lists
  if (error.name) {
    const errorNameLower = error.name.toLowerCase()
    // Explicit non-retryable takes precedence
    if (NON_RETRYABLE_ERROR_NAMES.has(errorNameLower)) {
      return false
    }
    if (STOP_ERROR_NAMES.has(errorNameLower)) {
      return false
    }
    // Check if it's a known retryable error
    if (RETRYABLE_ERROR_NAMES.has(errorNameLower)) {
      return true
    }
  }

  // Check message patterns for unknown errors
  const msg = error.message?.toLowerCase() ?? ""
  if (hasProviderAutoRetrySignal(msg)) {
    return true
  }
  return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => msg.includes(pattern))
}

/**
 * Determines if an error should trigger a fallback retry.
 * Returns true for deadstop errors that completely halt the action loop.
 */
export function shouldRetryError(error: ErrorInfo): boolean {
  return isRetryableModelError(error)
}

/**
 * Gets the next fallback model from the chain based on attempt count.
 * Returns undefined if all fallbacks have been exhausted.
 */
export function getNextFallback(
  fallbackChain: FallbackEntry[],
  attemptCount: number,
): FallbackEntry | undefined {
  return fallbackChain[attemptCount]
}

/**
 * Checks if there are more fallbacks available after the current attempt.
 */
export function hasMoreFallbacks(
  fallbackChain: FallbackEntry[],
  attemptCount: number,
): boolean {
  return attemptCount < fallbackChain.length
}

/**
 * Selects the best provider for a fallback entry.
 * Priority:
 * 1) First connected provider in the entry's provider preference order
 * 2) Preferred provider when connected (and entry providers are unavailable)
 * 3) First provider listed in the fallback entry
 */
export function selectFallbackProvider(
  providers: string[],
  preferredProviderID?: string,
): string {
  const connectedProviders = readConnectedProvidersCache()
  if (connectedProviders) {
    const connectedSet = new Set(connectedProviders.map(p => p.toLowerCase()))

    for (const provider of providers) {
      if (connectedSet.has(provider.toLowerCase())) {
        return provider
      }
    }

    if (
      preferredProviderID &&
      connectedSet.has(preferredProviderID.toLowerCase())
    ) {
      return preferredProviderID
    }
  }

  return providers[0] || preferredProviderID || "opencode"
}

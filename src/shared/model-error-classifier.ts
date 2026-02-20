import type { FallbackEntry } from "./model-requirements"
import { readConnectedProvidersCache } from "./connected-providers-cache"

/**
 * Error names that indicate a retryable model error (deadstop).
 * These errors completely halt the action loop and should trigger fallback retry.
 */
const RETRYABLE_ERROR_NAMES = new Set([
  "ProviderModelNotFoundError",
  "RateLimitError",
  "QuotaExceededError",
  "InsufficientCreditsError",
  "ModelUnavailableError",
  "ProviderConnectionError",
  "AuthenticationError",
])

/**
 * Error names that should NOT trigger retry.
 * These errors are typically user-induced or fixable without switching models.
 */
const NON_RETRYABLE_ERROR_NAMES = new Set([
  "MessageAbortedError",
  "PermissionDeniedError",
  "ContextLengthError",
  "TimeoutError",
  "ValidationError",
  "SyntaxError",
  "UserError",
])

/**
 * Message patterns that indicate a retryable error even without a known error name.
 */
const RETRYABLE_MESSAGE_PATTERNS = [
  "rate_limit",
  "rate limit",
  "quota",
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
  "503",
  "502",
  "504",
]

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
    // Explicit non-retryable takes precedence
    if (NON_RETRYABLE_ERROR_NAMES.has(error.name)) {
      return false
    }
    // Check if it's a known retryable error
    if (RETRYABLE_ERROR_NAMES.has(error.name)) {
      return true
    }
  }

  // Check message patterns for unknown errors
  const msg = error.message?.toLowerCase() ?? ""
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
 * 2) First provider listed in the fallback entry (when cache is missing)
 */
export function selectFallbackProvider(
  providers: string[],
  preferredProviderID?: string,
): string {
  const connectedProviders = readConnectedProvidersCache()
  if (connectedProviders) {
    const connectedSet = new Set(connectedProviders)
    for (const provider of providers) {
      if (connectedSet.has(provider)) {
        return provider
      }
    }
  }

  return providers[0] || preferredProviderID || "opencode"
}

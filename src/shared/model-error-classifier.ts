import type { FallbackEntry } from "./model-requirements"
import { readConnectedProvidersCache } from "./connected-providers-cache"

/**
 * Error names that indicate a retryable model error.
 * These errors halt execution and should trigger fallback retry.
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
  // model_not_supported / "model not supported" intentionally moved to
  // STOP_MESSAGE_PATTERNS — same provider will not start serving the
  // model on retry, so escape to a different provider is the right
  // recovery, not a same-provider retry.
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
  "selected provider is forbidden",
  "provider is forbidden",
]

/**
 * Message patterns that indicate a non-retryable STOP error — the failing
 * provider definitively cannot serve this request, but a DIFFERENT
 * provider may. Covers two semantically equivalent cases for routing:
 *   - billing/quota exhaustion ("insufficient balance", "out of credits", etc.)
 *   - model unavailability on this provider ("model_not_supported")
 * STOP takes precedence over RETRYABLE_MESSAGE_PATTERNS, so adding model-
 * unavailability here flips the runtime from "retry same provider/model
 * forever" (the loop the user reported on github-copilot/claude-opus-4.5)
 * to "this provider can't help; surface to manager which fires sticky
 * cross-provider escape or auto-mode crossProviderEscape".
 */
const STOP_MESSAGE_PATTERNS = [
  "quota will reset after",
  "quota exceeded",
  "usage limit has been reached",
  "free usage limit",
  "billing limit",
  "billing hard limit",
  "monthly limit",
  "plan limit",
  "subscription quota",
  "subscription limit",
  "payment required",
  "out of credits",
  "credits exhausted",
  "insufficient credits",
  "insufficient balance",
  "credit balance",
  "usage limit for this month",
  "exhausted your capacity",
  // Model unavailability on the failing provider — semantically a "stop"
  // because retrying on the same provider with the same model will return
  // the same error. Different provider may serve this model.
  "model_not_supported",
  "model not supported",
  "model is not supported",
  "the requested model is not supported",
]

const AUTO_RETRY_GATE_PATTERNS = [
  "rate limit",
  "cooling down",
  "credentials for model",
]

function hasProviderAutoRetrySignal(message: string): boolean {
  if (!message.includes("retrying in")) {
    return false
  }
  return AUTO_RETRY_GATE_PATTERNS.some((pattern) => message.includes(pattern))
}

/**
 * SDK transport-layer error patterns. These surface as `SyntaxError` /
 * `JsonParseError` from streaming response decoders when the SSE stream is
 * truncated mid-token (provider connection drop, buffer overrun, partial
 * tool-call delta) — NOT real syntax errors in user code. Matching these
 * patterns must override the `SyntaxError` non-retryable name lookup so
 * the runtime can retry the same model on a fresh stream rather than fail
 * the task permanently. Observed in the team-mode audit failure where the
 * member's first turn died with `JSON Parse error: Unterminated string`
 * and the queued team_send_message prompts were stranded.
 */
const TRANSPORT_ERROR_MESSAGE_PATTERNS = [
  "json parse error",
  "unterminated string",
  "unexpected end of stream",
  "unexpected end of json",
  "stream closed",
  "premature close",
  "socket hang up",
  "econnreset",
  "etimedout",
]

function hasTransportError(message: string): boolean {
  if (!message) return false
  return TRANSPORT_ERROR_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern))
}

export interface ErrorInfo {
  name?: string
  message?: string
}

/**
 * Determines if an error is a retryable model error.
 * Returns true if it's a known retryable type OR matches retryable message patterns.
 */
export function isRetryableModelError(error: ErrorInfo): boolean {
  const msg = error.message?.toLowerCase() ?? ""

  // SDK transport blip — overrides the non-retryable name lookup. Stream
  // truncation surfaces as `SyntaxError` from the JSON decoder but is a
  // network event, not a code error. Without this short-circuit, an
  // `Unterminated string` aborts the task permanently.
  if (hasTransportError(msg)) {
    return true
  }

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

  // STOP patterns take precedence over retryable patterns
  if (STOP_MESSAGE_PATTERNS.some((pattern) => msg.includes(pattern))) {
    return false
  }

  if (hasProviderAutoRetrySignal(msg)) {
    return true
  }
  return RETRYABLE_MESSAGE_PATTERNS.some((pattern) => msg.includes(pattern))
}

/**
 * Determines if an error should trigger a fallback retry.
 * Returns true for errors that halt execution.
 */
export function shouldRetryError(error: ErrorInfo): boolean {
  return isRetryableModelError(error)
}

/**
 * Determines if an error is a provider-scoped stop signal (the failing
 * provider has run out of capacity / credits / quota for this account, but
 * the user's other providers may still be reachable). Used by the fallback
 * handler to allow cross-provider escape: when the message says "insufficient
 * balance" on copilot but the chain offers an opencode-go entry, that entry
 * has its own balance pool and is worth trying.
 *
 * Returns false for user-fault errors (permission, validation, etc.) and for
 * generic retryable errors (rate_limit) which `shouldRetryError` already
 * covers via the standard chain.
 */
export function isProviderScopedStop(error: ErrorInfo): boolean {
  if (error.name) {
    const errorNameLower = error.name.toLowerCase()
    if (NON_RETRYABLE_ERROR_NAMES.has(errorNameLower)) return false
    if (STOP_ERROR_NAMES.has(errorNameLower)) return true
  }
  const msg = error.message?.toLowerCase() ?? ""
  if (!msg) return false
  return STOP_MESSAGE_PATTERNS.some((pattern) => msg.includes(pattern))
}

/**
 * True iff at least one fallback entry from `attemptCount` onward names a
 * provider different from `failingProviderID`. Used by the fallback handler
 * to decide whether a provider-scoped stop is worth retrying.
 */
export function hasCrossProviderFallback(
  chain: FallbackEntry[],
  attemptCount: number,
  failingProviderID: string | undefined,
): boolean {
  if (!failingProviderID) return false
  const failing = failingProviderID.toLowerCase()
  for (let i = Math.max(0, attemptCount); i < chain.length; i++) {
    const entry = chain[i]
    if (!entry) continue
    if (entry.providers.some((p) => p.toLowerCase() !== failing)) {
      return true
    }
  }
  return false
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

/**
 * Runtime Fallback Hook - Constants
 *
 * Default values and configuration constants for the runtime fallback feature.
 */

import type { RuntimeFallbackConfig } from "../../config"

/**
 * Default configuration values for runtime fallback
 */
export const DEFAULT_CONFIG: Required<RuntimeFallbackConfig> = {
  enabled: true,
  retry_on_errors: [429, 503, 529],
  max_fallback_attempts: 3,
  cooldown_seconds: 60,
  notify_on_fallback: true,
}

/**
 * Error patterns that indicate rate limiting or temporary failures
 * These are checked in addition to HTTP status codes
 */
export const RETRYABLE_ERROR_PATTERNS = [
  /rate.?limit/i,
  /too.?many.?requests/i,
  /quota.?exceeded/i,
  /service.?unavailable/i,
  /overloaded/i,
  /temporarily.?unavailable/i,
  /try.?again/i,
  /\b429\b/,
  /\b503\b/,
  /\b529\b/,
]

/**
 * Hook name for identification and logging
 */
export const HOOK_NAME = "runtime-fallback"

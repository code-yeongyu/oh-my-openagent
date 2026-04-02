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
  enabled: false,
  retry_on_errors: [402, 429, 500, 502, 503, 504],
  max_fallback_attempts: 3,
  cooldown_seconds: 60,
  timeout_seconds: 30,
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
  /quota\s+will\s+reset\s+after/i,
  /(?:you(?:'ve|\s+have)\s+)?reached\s+your\s+usage\s+limit/i,
  /all\s+credentials\s+for\s+model/i,
  /cool(?:ing)?\s+down/i,
  /exhausted\s+your\s+capacity/i,
  /usage\s+limit\s+has\s+been\s+reached/i,
  /model.{0,20}?not.{0,10}?supported/i,
  /model_not_supported/i,
  /service.?unavailable/i,
  /overloaded/i,
  /temporarily.?unavailable/i,
  /try.?again/i,
  /credit.*balance.*too.*low/i,
  /insufficient.?(?:credits?|funds?|balance)/i,
  /subscription.*quota/i,
  /billing.?(?:hard.?)?limit/i,
  /payment.?required/i,
  /out\s+of\s+credits?/i,
  /(?:^|\s)402(?:\s|$)/,
  /(?:^|\s)429(?:\s|$)/,
  /(?:^|\s)503(?:\s|$)/,
  /(?:^|\s)529(?:\s|$)/,
]

/**
 * Hook name for identification and logging
 */
export const HOOK_NAME = "runtime-fallback"

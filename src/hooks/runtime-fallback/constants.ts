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
  retry_on_errors: [429, 500, 502, 503, 504],
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
  /quota\s+will\s+reset\s+after/i,
  /quota.?exceeded/i,
  /exhausted\s+your\s+capacity/i,
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

  // Chinese rate-limit / quota patterns (Zhipu, etc.)
  /使用上限/,           // "usage limit" — Zhipu: "已达到 5 小时的使用上限"
  /频率限制/,           // "rate limit" — generic Chinese rate-limit
  /请求过于频繁/,       // "too many requests" — common Chinese 429 message
  /暂时不可用/,         // "temporarily unavailable"
  /服务不可用/,         // "service unavailable"
  /请稍后重试/,         // "please try again later"
]

/**
 * Hook name for identification and logging
 */
export const HOOK_NAME = "runtime-fallback"
ENDOFFILEILE

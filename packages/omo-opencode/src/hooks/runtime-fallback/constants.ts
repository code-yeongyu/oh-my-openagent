/**
 * Runtime Fallback Hook - Constants
 *
 * Default values and configuration constants for the runtime fallback feature.
 */

import { RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS } from "@oh-my-opencode/model-core"
import type { RuntimeFallbackConfig } from "../../config"

/**
 * First-prompt watchdog: how long to wait for the first sign of progress
 * (assistant text/reasoning/finish) from a subagent session before assuming
 * the provider is silently stuck and dispatching the configured fallback.
 *
 * Reasoning-heavy models and relays legitimately take longer than 90 s before
 * their first progress event (#11887), so this matches the 300 s stream-start
 * bound the engines themselves use; it stays well below the 30-minute outer
 * poll timeout. `runtime_fallback.first_prompt_timeout_seconds` overrides it.
 */
export const DEFAULT_FIRST_PROMPT_WATCHDOG_MS = 300_000

/**
 * Default configuration values for runtime fallback
 */
export const DEFAULT_CONFIG: Required<RuntimeFallbackConfig> = {
  enabled: false,
  retry_on_errors: [429, 500, 502, 503, 504],
  max_fallback_attempts: 3,
  cooldown_seconds: 60,
  timeout_seconds: 30,
  first_prompt_timeout_seconds: DEFAULT_FIRST_PROMPT_WATCHDOG_MS / 1000,
  notify_on_fallback: true,
  restore_primary_after_cooldown: false,
}

/**
 * Error patterns that indicate rate limiting or temporary failures
 * These are checked in addition to HTTP status codes
 */
export const RETRYABLE_ERROR_PATTERNS = RUNTIME_FALLBACK_RETRYABLE_ERROR_PATTERNS

/**
 * Hook name for identification and logging
 */
export const HOOK_NAME = "runtime-fallback"

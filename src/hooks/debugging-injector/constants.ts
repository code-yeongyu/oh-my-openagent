/**
 * Debugging Injector Hook Constants
 */

import type { DebugInjectorConfig } from "./types"

/**
 * Default configuration for Debugging Injector
 */
export const DEFAULT_DEBUG_INJECTOR_CONFIG: DebugInjectorConfig = {
  enabled: false,
  failure_threshold: 2,
  inject_skill_on_threshold: true,
  reset_on_success: true,
  failure_window_ms: 30 * 60 * 1000, // 30 minutes
}

/**
 * Patterns that indicate a fix attempt failure
 */
export const FAILURE_PATTERNS: RegExp[] = [
  /error/i,
  /failed/i,
  /exception/i,
  /cannot/i,
  /unable/i,
  /not found/i,
  /undefined/i,
  /null/i,
  /type.*error/i,
  /syntax.*error/i,
]

/**
 * Tools that can indicate a fix attempt
 */
export const FIX_ATTEMPT_TOOLS = ["edit", "write"]

/**
 * Tools that can indicate verification failure
 */
export const VERIFICATION_TOOLS = ["bash", "lsp_diagnostics"]

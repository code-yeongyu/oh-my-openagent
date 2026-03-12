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
  /quota.?exceeded/i,
  /quota\s+will\s+reset\s+after/i,
  /limit\s+exhausted/i,
  /weekly\/monthly/i,
  /your\s+limit\s+will\s+reset/i,
  /all\s+credentials\s+for\s+model/i,
  /cool(?:ing)?\s+down/i,
  /exhausted\s+your\s+capacity/i,
  /usage\s+limit\s+has\s+been\s+reached/i,
  /service.?unavailable/i,
  /overloaded/i,
  /temporarily.?unavailable/i,
  /try.?again/i,
  /credit.*balance.*too.*low/i,
  /insufficient.?(?:credits?|funds?|balance)/i,
  /(?:^|\s)429(?:\s|$)/,
  /(?:^|\s)503(?:\s|$)/,
  /(?:^|\s)529(?:\s|$)/,
]

/**
 * Hook name for identification and logging
 */
export const HOOK_NAME = "runtime-fallback"

/**
 * Global provider blacklist - shared across all sessions
 * Maps providerID -> timestamp when it was blacklisted
 */
export const globalProviderBlacklist = new Map<string, number>()

/**
 * Check if a provider is globally blacklisted
 */
export function isProviderBlacklisted(providerID: string, cooldownSeconds: number): boolean {
  const blacklistedAt = globalProviderBlacklist.get(providerID)
  if (blacklistedAt === undefined) return false
  const cooldownMs = cooldownSeconds * 1000
  const isStillBlacklisted = Date.now() - blacklistedAt < cooldownMs
  if (!isStillBlacklisted) {
    globalProviderBlacklist.delete(providerID)
  }
  return isStillBlacklisted
}

/**
 * Blacklist a provider globally
 */
export function blacklistProvider(providerID: string): void {
  globalProviderBlacklist.set(providerID, Date.now())
}

/**
 * Get list of currently blacklisted providers
 */
export function getBlacklistedProviders(cooldownSeconds: number): string[] {
  const now = Date.now()
  const cooldownMs = cooldownSeconds * 1000
  const result: string[] = []
  
  for (const [providerID, blacklistedAt] of globalProviderBlacklist.entries()) {
    if (now - blacklistedAt < cooldownMs) {
      result.push(providerID)
    } else {
      globalProviderBlacklist.delete(providerID)
    }
  }
  
  return result
}

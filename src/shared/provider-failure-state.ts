/**
 * Shared in-memory state tracking providers that have failed at runtime.
 *
 * Bridges the gap between the proactive `modelFallback` (chat.params) and
 * reactive `runtimeFallback` (session.error) systems. When runtime-fallback
 * classifies a provider error as quota_exceeded or rate-limited, it marks the
 * provider here so the proactive system can skip it on subsequent requests.
 *
 * This is a per-process in-memory store — cleared on plugin restart.
 */

const failedProviders = new Set<string>()
let cooldownMs = 120_000 // 2 minutes default

/**
 * Mark a provider as failed (e.g., quota exhausted, rate-limited).
 * The provider will be skipped by the proactive fallback system
 * until `clearProviderFailure` is called or the cooldown expires.
 */
export function markProviderFailed(providerID: string): void {
  failedProviders.add(providerID.toLowerCase())
}

/**
 * Check if a provider has been marked as failed.
 */
export function isProviderFailed(providerID: string): boolean {
  return failedProviders.has(providerID.toLowerCase())
}

/**
 * Clear a provider's failure state (e.g., after manual switch or cool-down).
 */
export function clearProviderFailure(providerID: string): void {
  failedProviders.delete(providerID.toLowerCase())
}

/**
 * Clear all provider failures (e.g., on session end or plugin restart).
 */
export function clearAllProviderFailures(): void {
  failedProviders.clear()
}

/**
 * Get the set of currently failed providers (for debugging/logging).
 */
export function getFailedProviders(): string[] {
  return Array.from(failedProviders)
}

/**
 * Set cooldown duration in milliseconds.
 */
export function setProviderFailureCooldownMs(ms: number): void {
  cooldownMs = ms
}

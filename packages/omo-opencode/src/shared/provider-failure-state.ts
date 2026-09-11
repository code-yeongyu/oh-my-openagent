/**
 * Shared in-memory state tracking providers that have failed at runtime.
 *
 * Bridges the gap between the proactive `modelFallback` (chat.params) and
 * reactive `runtimeFallback` (session.error) systems. When runtime-fallback
 * classifies a provider error as quota_exceeded or rate-limited, it marks the
 * provider here so the proactive system can skip it on subsequent requests.
 *
 * This is a per-session in-memory store — cleared when the session is deleted
 * or the plugin process restarts.
 */

const failedProvidersBySession = new Map<string, Map<string, number>>()
let cooldownMs = 120_000 // 2 minutes default

/**
 * Mark a provider as failed (e.g., quota exhausted, rate-limited).
 * The provider will be skipped by the proactive fallback system
 * until the session is cleared or the cooldown expires.
 */
export function markProviderFailed(sessionID: string, providerID: string): void {
  const failedProviders = failedProvidersBySession.get(sessionID) ?? new Map<string, number>()
  failedProviders.set(providerID.toLowerCase(), Date.now())
  failedProvidersBySession.set(sessionID, failedProviders)
}

/**
 * Check if a provider has been marked as failed.
 */
export function isProviderFailed(sessionID: string, providerID: string): boolean {
  const failedProviders = failedProvidersBySession.get(sessionID)
  if (!failedProviders) return false

  const id = providerID.toLowerCase()
  const failedAt = failedProviders.get(id)
  if (failedAt === undefined) return false
  if (Date.now() - failedAt < cooldownMs) return true
  failedProviders.delete(id)
  if (failedProviders.size === 0) failedProvidersBySession.delete(sessionID)
  return false
}

/**
 * Clear one session's provider failures when that session is deleted.
 */
export function clearSessionProviderFailures(sessionID: string): void {
  failedProvidersBySession.delete(sessionID)
}

/**
 * Clear all provider failures (e.g., on plugin restart or in tests).
 */
export function clearAllProviderFailures(): void {
  failedProvidersBySession.clear()
}

/**
 * Get the set of currently failed providers (for debugging/logging).
 */
export function getFailedProviders(sessionID: string): string[] {
  const failedProviders = failedProvidersBySession.get(sessionID)
  if (!failedProviders) return []

  const now = Date.now()
  const active: string[] = []
  for (const [id, failedAt] of failedProviders) {
    if (now - failedAt < cooldownMs) {
      active.push(id)
    } else {
      failedProviders.delete(id)
    }
  }
  if (failedProviders.size === 0) failedProvidersBySession.delete(sessionID)
  return active
}

/**
 * Set cooldown duration in milliseconds.
 */
export function setProviderFailureCooldownMs(ms: number): void {
  cooldownMs = ms
}

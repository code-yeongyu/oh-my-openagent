/**
 * Session Provider Override State
 *
 * Tracks when a session has been switched to a fallback provider due to blacklist.
 * This ensures that subsequent messages continue using the fallback provider
 * until the original provider recovers.
 *
 * Key behaviors:
 * - When a provider is blacklisted, we store the fallback provider info
 * - On every subsequent message, we check if the session has an active override
 * - If the original provider is still blacklisted, we continue using the fallback
 * - If the original provider has recovered, we clear the override
 */

export type ProviderOverride = {
  /** The fallback provider ID to use */
  providerID: string
  /** The fallback model ID to use */
  modelID: string
  /** Optional variant for the fallback model */
  variant?: string
  /** The original blacklisted provider ID (for recovery checking) */
  originalProviderID: string
  /** Timestamp when the override was set */
  setAt: number
}

/** Map of sessionID -> provider override */
const sessionProviderOverrides = new Map<string, ProviderOverride>()

/**
 * Sets a provider override for a session.
 * Called when a blacklisted provider is detected and a fallback is applied.
 */
export function setSessionProviderOverride(
  sessionID: string,
  originalProviderID: string,
  fallbackProviderID: string,
  fallbackModelID: string,
  fallbackVariant?: string
): void {
  sessionProviderOverrides.set(sessionID, {
    providerID: fallbackProviderID,
    modelID: fallbackModelID,
    variant: fallbackVariant,
    originalProviderID,
    setAt: Date.now(),
  })
}

/**
 * Gets the active provider override for a session, if any.
 */
export function getSessionProviderOverride(sessionID: string): ProviderOverride | undefined {
  return sessionProviderOverrides.get(sessionID)
}

/**
 * Clears the provider override for a session.
 * Called when the original provider recovers or session ends.
 */
export function clearSessionProviderOverride(sessionID: string): void {
  sessionProviderOverrides.delete(sessionID)
}

/**
 * Checks if a session has an active provider override.
 */
export function hasSessionProviderOverride(sessionID: string): boolean {
  return sessionProviderOverrides.has(sessionID)
}

/**
 * Gets the original provider ID that was blacklisted for this session.
 * Useful for checking if the provider has recovered.
 */
export function getOriginalBlacklistedProvider(sessionID: string): string | undefined {
  return sessionProviderOverrides.get(sessionID)?.originalProviderID
}

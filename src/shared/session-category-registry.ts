/**
 * Session Category Registry
 *
 * Maintains a mapping of session IDs to their assigned categories.
 * Used by runtime-fallback hook to lookup category-specific fallback_models.
 */

// Map of sessionID -> category name
const sessionCategoryMap = new Map<string, string>()

export const SessionCategoryRegistry = {
  /**
   * Register a session with its category
   */
  register: (sessionID: string, category: string): void => {
    sessionCategoryMap.set(sessionID, category)
  },

  /**
   * Get the category for a session
   */
  get: (sessionID: string): string | undefined => {
    return sessionCategoryMap.get(sessionID)
  },

  /**
   * Remove a session from the registry (cleanup)
   */
  remove: (sessionID: string): void => {
    sessionCategoryMap.delete(sessionID)
  },

  /**
   * Check if a session is registered
   */
  has: (sessionID: string): boolean => {
    return sessionCategoryMap.has(sessionID)
  },

  /**
   * Get the size of the registry (for debugging)
   */
  size: (): number => {
    return sessionCategoryMap.size
  },

  /**
   * Clear all entries (use with caution, mainly for testing)
   */
  clear: (): void => {
    sessionCategoryMap.clear()
  },
}

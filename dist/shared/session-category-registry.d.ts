/**
 * Session Category Registry
 *
 * Maintains a mapping of session IDs to their assigned categories.
 * Used by runtime-fallback hook to lookup category-specific fallback_models.
 */
export declare const SessionCategoryRegistry: {
    /**
     * Register a session with its category
     */
    register: (sessionID: string, category: string) => void;
    /**
     * Get the category for a session
     */
    get: (sessionID: string) => string | undefined;
    /**
     * Remove a session from the registry (cleanup)
     */
    remove: (sessionID: string) => void;
    /**
     * Check if a session is registered
     */
    has: (sessionID: string) => boolean;
    /**
     * Get the size of the registry (for debugging)
     */
    size: () => number;
    /**
     * Clear all entries (use with caution, mainly for testing)
     */
    clear: () => void;
};

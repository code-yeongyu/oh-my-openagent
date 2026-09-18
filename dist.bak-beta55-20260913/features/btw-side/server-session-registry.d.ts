export declare function trackBtwSideSession(session: {
    id: string;
    metadata?: Record<string, unknown>;
}): boolean;
export declare function markBtwSideSession(sessionID: string): void;
export declare function forgetBtwSideSession(sessionID: string): boolean;
export declare function isTrackedBtwSideSession(sessionID: string): boolean;
export declare function resetBtwSideSessionRegistryForTesting(): void;

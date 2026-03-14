type SessionState = {
    inFlight: boolean;
    consecutiveAutoContinueCount: number;
    awaitingAutoContinuationResponse: boolean;
    lastHandledMessageID?: string;
    lastAutoContinuePermissionPhrase?: string;
    lastInjectedAt?: number;
};
export type SessionStateStore = ReturnType<typeof createSessionStateStore>;
export declare function createSessionStateStore(): {
    getState: (sessionID: string) => SessionState;
    wasRecentlyInjected(sessionID: string, windowMs: number): boolean;
    cleanup(sessionID: string): void;
};
export {};

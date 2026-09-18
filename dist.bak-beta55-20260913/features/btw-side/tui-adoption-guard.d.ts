export declare function createBtwAdoptionGuard(currentSessionID: () => string | undefined): {
    canApply: (sessionID: string, parentSessionID?: string) => boolean;
    markDeleted: (sessionID: string) => void;
    dispose: () => void;
};

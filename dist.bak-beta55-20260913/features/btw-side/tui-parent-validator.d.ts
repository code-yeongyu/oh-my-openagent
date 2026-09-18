export declare function createBtwParentValidator(dependencies: {
    fetchStatus: (sessionID: string) => Promise<"exists" | "missing" | "retry">;
}): {
    exists: (sessionID: string) => Promise<boolean>;
    markDeleted: (sessionID: string) => void;
};

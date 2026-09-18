type StopContinuationHooks = {
    readonly keywordDetector?: {
        readonly clearSession?: (sessionID: string) => void;
    } | null;
    readonly stopContinuationGuard?: {
        readonly stop?: (sessionID: string) => void;
    } | null;
    readonly todoContinuationEnforcer?: {
        readonly cancelAllCountdowns: () => void;
    } | null;
    readonly goal?: {
        readonly clearGoal: (sessionID: string) => boolean;
    } | null;
};
export declare function stopContinuation(args: {
    readonly directory: string;
    readonly hooks: StopContinuationHooks;
    readonly sessionID: string;
}): void;
export {};

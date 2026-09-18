export type RuntimeFallbackTestClock = {
    readonly advanceBy: (ms: number) => Promise<void>;
    readonly restore: () => void;
};
export declare function installRuntimeFallbackTestClock(startAt?: number): RuntimeFallbackTestClock;
export declare function restoreRuntimeFallbackTestClock(): void;

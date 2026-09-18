export declare function pruneRecentSyntheticIdles(args: {
    recentSyntheticIdles: Map<string, number>;
    recentRealIdles: Map<string, number>;
    recentAnyIdles: Map<string, number>;
    now: number;
    dedupWindowMs: number;
}): void;

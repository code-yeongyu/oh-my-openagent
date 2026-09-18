import type { FallbackState } from "./types";
type FallbackStateSnapshot = {
    readonly originalModel: string;
    readonly currentModel: string;
    readonly fallbackIndex: number;
    readonly failedModels: Map<string, number>;
    readonly attemptCount: number;
    readonly pendingFallbackModel: string | undefined;
    readonly pendingFallbackPromptMayHaveBeenAccepted: boolean | undefined;
};
export declare function snapshotFallbackState(state: FallbackState): FallbackStateSnapshot;
export declare function restoreFallbackState(state: FallbackState, snapshot: FallbackStateSnapshot): void;
export {};

import type { FallbackEntry } from "../../shared/model-requirements";
import { getNextReachableFallback } from "./next-fallback";
type ModelFallbackStateLike = {
    providerID: string;
    modelID: string;
    fallbackChain: FallbackEntry[];
    attemptCount: number;
    pending: boolean;
};
export type ModelFallbackStateController = {
    lastToastKey: Map<string, string>;
    setSessionFallbackChain: (sessionID: string, fallbackChain: FallbackEntry[] | undefined) => void;
    getSessionFallbackChain: (sessionID: string) => FallbackEntry[] | undefined;
    clearSessionFallbackChain: (sessionID: string) => void;
    setPendingModelFallback: (sessionID: string, agentName: string, currentProviderID: string, currentModelID: string) => boolean;
    getNextFallback: (sessionID: string) => ReturnType<typeof getNextReachableFallback>;
    clearPendingModelFallback: (sessionID: string) => void;
    hasPendingModelFallback: (sessionID: string) => boolean;
    getFallbackState: (sessionID: string) => ModelFallbackStateLike | undefined;
    reset: () => void;
};
export declare function createModelFallbackStateController(input: {
    pendingModelFallbacks: Map<string, ModelFallbackStateLike>;
    lastToastKey: Map<string, string>;
    sessionFallbackChains: Map<string, FallbackEntry[]>;
}): ModelFallbackStateController;
export {};

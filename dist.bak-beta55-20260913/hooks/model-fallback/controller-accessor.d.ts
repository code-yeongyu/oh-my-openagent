import type { FallbackEntry } from "../../shared/model-requirements";
import type { ModelFallbackStateController } from "./fallback-state-controller";
export type ModelFallbackControllerAccessor = {
    register: (controller: ModelFallbackStateController) => void;
    setSessionFallbackChain: (sessionID: string, fallbackChain: FallbackEntry[] | undefined) => void;
    getSessionFallbackChain: (sessionID: string) => FallbackEntry[] | undefined;
    clearSessionFallbackChain: (sessionID: string) => void;
};
export declare function createModelFallbackControllerAccessor(): ModelFallbackControllerAccessor;

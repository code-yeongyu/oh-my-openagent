import type { ModelCacheState } from "../plugin-state";
export declare function applyProviderConfig(params: {
    config: Record<string, unknown>;
    modelCacheState: ModelCacheState;
    trustedVisionCapableModels?: string[];
}): void;

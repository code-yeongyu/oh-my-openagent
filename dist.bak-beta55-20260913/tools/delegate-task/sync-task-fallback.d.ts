import type { FallbackEntry } from "../../shared/model-requirements";
import type { DelegatedModelConfig } from "./types";
import type { ModelFallbackState } from "../../hooks/model-fallback/hook";
export declare function retrySyncPromptWithFallbacks(input: {
    sessionID: string;
    initialError: string;
    categoryModel: DelegatedModelConfig | undefined;
    fallbackChain: FallbackEntry[] | undefined;
    sendPrompt: (categoryModel: DelegatedModelConfig) => Promise<string | null>;
}): Promise<{
    promptError: string | null;
    categoryModel: DelegatedModelConfig | undefined;
    fallbackState?: ModelFallbackState;
}>;
export declare function getNextSyncFallbackModel(sessionID: string, fallbackState: ModelFallbackState | undefined): DelegatedModelConfig | null;

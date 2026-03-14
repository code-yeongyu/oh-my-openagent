import type { ModelFallbackInfo } from "../../features/task-toast-manager/types";
import type { DelegateTaskArgs } from "./types";
import type { ExecutorContext } from "./executor-types";
import type { FallbackEntry } from "../../shared/model-requirements";
export interface CategoryResolutionResult {
    agentToUse: string;
    categoryModel: {
        providerID: string;
        modelID: string;
        variant?: string;
    } | undefined;
    categoryPromptAppend: string | undefined;
    maxPromptTokens?: number;
    modelInfo: ModelFallbackInfo | undefined;
    actualModel: string | undefined;
    isUnstableAgent: boolean;
    fallbackChain?: FallbackEntry[];
    error?: string;
}
export declare function resolveCategoryExecution(args: DelegateTaskArgs, executorCtx: ExecutorContext, inheritedModel: string | undefined, systemDefaultModel: string | undefined): Promise<CategoryResolutionResult>;

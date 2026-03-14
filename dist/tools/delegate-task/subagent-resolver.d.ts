import type { DelegateTaskArgs } from "./types";
import type { ExecutorContext } from "./executor-types";
import type { FallbackEntry } from "../../shared/model-requirements";
export declare function resolveSubagentExecution(args: DelegateTaskArgs, executorCtx: ExecutorContext, parentAgent: string | undefined, categoryExamples: string): Promise<{
    agentToUse: string;
    categoryModel: {
        providerID: string;
        modelID: string;
        variant?: string;
    } | undefined;
    fallbackChain?: FallbackEntry[];
    error?: string;
}>;

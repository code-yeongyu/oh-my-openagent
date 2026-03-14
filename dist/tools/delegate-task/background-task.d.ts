import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types";
import type { ExecutorContext, ParentContext } from "./executor-types";
import type { FallbackEntry } from "../../shared/model-requirements";
export declare function executeBackgroundTask(args: DelegateTaskArgs, ctx: ToolContextWithMetadata, executorCtx: ExecutorContext, parentContext: ParentContext, agentToUse: string, categoryModel: {
    providerID: string;
    modelID: string;
    variant?: string;
} | undefined, systemContent: string | undefined, fallbackChain?: FallbackEntry[]): Promise<string>;

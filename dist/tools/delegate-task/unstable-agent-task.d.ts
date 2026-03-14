import type { DelegateTaskArgs, ToolContextWithMetadata } from "./types";
import type { ExecutorContext, ParentContext } from "./executor-types";
export declare function executeUnstableAgentTask(args: DelegateTaskArgs, ctx: ToolContextWithMetadata, executorCtx: ExecutorContext, parentContext: ParentContext, agentToUse: string, categoryModel: {
    providerID: string;
    modelID: string;
    variant?: string;
} | undefined, systemContent: string | undefined, actualModel: string | undefined): Promise<string>;

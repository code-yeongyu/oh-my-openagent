import type { ParentContext } from "./executor-types";
import type { DelegatedModelConfig, DelegateTaskArgs } from "./types";
export declare function buildRecoveredSyncTaskCompletion(input: {
    readonly activeSessionID: string;
    readonly agentToUse: string;
    readonly args: DelegateTaskArgs;
    readonly effectiveCategoryModel: DelegatedModelConfig | undefined;
    readonly parentContext: ParentContext;
    readonly startTime: Date;
    readonly textContent: string;
}): string;
export declare function buildSyncTaskCompletion(input: {
    readonly activeSessionID: string;
    readonly agentToUse: string;
    readonly args: DelegateTaskArgs;
    readonly effectiveCategoryModel: DelegatedModelConfig | undefined;
    readonly parentContext: ParentContext;
    readonly startTime: Date;
    readonly textContent: string;
}): string;

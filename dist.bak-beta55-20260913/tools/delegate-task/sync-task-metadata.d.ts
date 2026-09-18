import type { ParentContext } from "./executor-types";
import type { DelegatedModelConfig, DelegateTaskArgs, ToolContextWithMetadata } from "./types";
export declare function publishSyncTaskMetadata(input: {
    readonly args: DelegateTaskArgs;
    readonly ctx: ToolContextWithMetadata;
    readonly currentSessionID: string;
    readonly currentModel: DelegatedModelConfig | undefined;
    readonly parentContext: ParentContext;
    readonly agentToUse: string;
    readonly spawnDepth: number;
}): Promise<void>;

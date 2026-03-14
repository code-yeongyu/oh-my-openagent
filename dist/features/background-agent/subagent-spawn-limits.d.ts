import type { BackgroundTaskConfig } from "../../config/schema";
import type { OpencodeClient } from "./constants";
export declare const DEFAULT_MAX_SUBAGENT_DEPTH = 3;
export declare const DEFAULT_MAX_ROOT_SESSION_SPAWN_BUDGET = 50;
export interface SubagentSpawnContext {
    rootSessionID: string;
    parentDepth: number;
    childDepth: number;
}
export declare function getMaxSubagentDepth(config?: BackgroundTaskConfig): number;
export declare function getMaxRootSessionSpawnBudget(config?: BackgroundTaskConfig): number;
export declare function resolveSubagentSpawnContext(client: OpencodeClient, parentSessionID: string): Promise<SubagentSpawnContext>;
export declare function createSubagentDepthLimitError(input: {
    childDepth: number;
    maxDepth: number;
    parentSessionID: string;
    rootSessionID: string;
}): Error;
export declare function createSubagentDescendantLimitError(input: {
    rootSessionID: string;
    descendantCount: number;
    maxDescendants: number;
}): Error;

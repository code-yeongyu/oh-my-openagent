import type { UlwLoopScope } from "./paths.js";
import type { UlwLoopPlan, UlwLoopSteeringAudit, UlwLoopSteeringProposal } from "./types.js";
export interface SteerUlwLoopBatchItemResult {
    readonly accepted: boolean;
    readonly deduped: boolean;
    readonly audit: UlwLoopSteeringAudit;
    readonly rejectedReasons: readonly string[];
}
export interface SteerUlwLoopBatchResult {
    readonly plan: UlwLoopPlan;
    readonly accepted: boolean;
    readonly results: readonly SteerUlwLoopBatchItemResult[];
    readonly rejectedReasons: readonly string[];
}
export declare function steerUlwLoopBatch(repoRoot: string, proposals: readonly UlwLoopSteeringProposal[], scope?: UlwLoopScope): Promise<SteerUlwLoopBatchResult>;

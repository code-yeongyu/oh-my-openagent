import { type UlwLoopScope } from "./paths.js";
export interface CheckpointTemplate {
    readonly qualityGateTemplate: Record<string, unknown>;
    readonly codexGoalTemplate: Record<string, unknown>;
    readonly attemptDir?: string;
    readonly guidance?: string;
}
export declare function checkpointTemplate(repoRoot: string, scope?: UlwLoopScope, goalId?: string): Promise<CheckpointTemplate>;

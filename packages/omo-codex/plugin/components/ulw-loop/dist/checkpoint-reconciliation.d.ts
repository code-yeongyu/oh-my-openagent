import type { CodexGoalReconciliation, CodexGoalSnapshot } from "./codex-goal-snapshot.js";
import { type UlwLoopScope } from "./paths.js";
import type { UlwLoopItem, UlwLoopPlan } from "./types.js";
import { UlwLoopError } from "./types.js";
export interface CodexSnapshotMismatchInput {
    readonly reconciliation: CodexGoalReconciliation;
    readonly snapshot: CodexGoalSnapshot | null | undefined;
    readonly expectedObjective: string;
    /** Only the checkpoint path can fall back to task-scoped aggregate reconciliation, so only it asks for that hint. */
    readonly taskScopedHint?: {
        readonly goal: UlwLoopItem;
        readonly aggregate: boolean;
        readonly final: boolean;
    };
}
export declare function codexSnapshotMismatchError(input: CodexSnapshotMismatchInput): UlwLoopError;
export declare function canReconcileCompletedTaskScopedAggregateSnapshot(repoRoot: string, plan: UlwLoopPlan, goal: UlwLoopItem, snapshotObjective: string, evidence: string, scope?: UlwLoopScope): Promise<boolean>;
export declare function canReconcileActiveFinalTaskScopedAggregateSnapshot(repoRoot: string, plan: UlwLoopPlan, goal: UlwLoopItem, snapshotObjective: string, evidence: string, scope?: UlwLoopScope): Promise<boolean>;
export declare function buildTaskScopedAggregateReconciliationHint(goal: UlwLoopItem, final: boolean): string;

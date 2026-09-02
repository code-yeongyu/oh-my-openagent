import type { UlwLoopScope } from "./paths.js";
import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan } from "./types.js";
export interface RecordFinalReviewBlockersArgs {
    readonly goalId: string;
    readonly title: string;
    readonly objective: string;
    readonly evidence: string;
    readonly codexGoalJson: string;
}
export interface RecordFinalReviewBlockersResult {
    readonly plan: UlwLoopPlan;
    readonly blockedGoal: UlwLoopItem;
    readonly newGoal: UlwLoopItem;
    readonly ledgerEntries: UlwLoopLedgerEntry[];
}
export declare function recordFinalReviewBlockers(repoRoot: string, args: RecordFinalReviewBlockersArgs, scope?: UlwLoopScope): Promise<RecordFinalReviewBlockersResult>;

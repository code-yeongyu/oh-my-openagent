import type { UlwLoopScope } from "./paths.js";
import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan, UlwLoopSuccessCriterion } from "./types.js";
type EvidenceStatus = "pass" | "fail" | "blocked";
type RecordEvidenceArgs = {
    readonly goalId: string;
    readonly criterionId: string;
    readonly status: EvidenceStatus;
    readonly evidence: string;
    readonly notes?: string;
};
export declare function recordEvidence(repoRoot: string, args: RecordEvidenceArgs, scope?: UlwLoopScope): Promise<{
    plan: UlwLoopPlan;
    goal: UlwLoopItem;
    criterion: UlwLoopSuccessCriterion;
    ledgerEntry: UlwLoopLedgerEntry;
}>;
export declare function markCriteriaPendingResetForGoal(repoRoot: string, goalId: string, scope?: UlwLoopScope): Promise<{
    plan: UlwLoopPlan;
    resetCount: number;
}>;
export declare function criteriaSummary(plan: UlwLoopPlan): {
    totalCriteria: number;
    passCount: number;
    pendingCount: number;
    failCount: number;
    blockedCount: number;
    goalsWithUnresolvedCriteria: string[];
};
export declare function unresolvedCriteriaOf(goal: UlwLoopItem): UlwLoopSuccessCriterion[];
export declare function unresolvedEssentialCriteriaOf(goal: UlwLoopItem): readonly UlwLoopSuccessCriterion[];
export declare function requireAllCriteriaPass(goal: UlwLoopItem): void;
export declare function requireAllPlanCriteriaPass(plan: UlwLoopPlan): void;
export declare function requireEssentialCriteriaPass(goal: UlwLoopItem): void;
export {};

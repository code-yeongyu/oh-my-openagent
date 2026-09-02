import type { UlwLoopItem, UlwLoopLedgerEntry, UlwLoopPlan, UlwLoopQualityGate, UlwLoopValidationBatch } from "./types.js";
export declare function parseValidationBatches(input: string | undefined, goals: readonly UlwLoopItem[]): Promise<readonly UlwLoopValidationBatch[] | undefined>;
export declare function updateBatchesAfterSupersede(plan: UlwLoopPlan, targetId: string, replacementIds: readonly string[]): void;
export declare function batchUpdateLedgerEntry(before: UlwLoopPlan, after: UlwLoopPlan, at: string): UlwLoopLedgerEntry | null;
export declare function batchOf(plan: UlwLoopPlan, goalId: string): UlwLoopValidationBatch | undefined;
export declare function batchClosedBy(plan: UlwLoopPlan, goalId: string): UlwLoopValidationBatch | undefined;
export declare function requireBatchFinalReady(plan: UlwLoopPlan, goal: UlwLoopItem): void;
export declare function requireAllValidationBatchesClosed(plan: UlwLoopPlan, closingGoalId?: string): void;
export declare function requireBatchGate(plan: UlwLoopPlan, goal: UlwLoopItem, gate: UlwLoopQualityGate): void;

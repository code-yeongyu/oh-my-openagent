import type { UlwLoopItem, UlwLoopPlan } from "./types.js";
export declare function normalizeBlockerEvidence(evidence: string): string;
export declare function classifyExternalAuthorizationBlocker(evidence: string): string | null;
export declare function sameBlockerOccurrences(plan: UlwLoopPlan, signature: string): number;
export declare function clearGoalBlockerFields(goal: UlwLoopItem): void;

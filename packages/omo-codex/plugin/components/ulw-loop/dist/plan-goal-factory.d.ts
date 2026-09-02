import type { UlwLoopItem, UlwLoopPlan, UlwLoopSuccessCriterion } from "./types.js";
export declare function seedDefaultSuccessCriteria(goalIndex: number, objective: string): UlwLoopSuccessCriterion[];
export declare function deriveGoalCandidates(brief: string): Array<{
    title: string;
    objective: string;
}>;
export declare function makeGoal(title: string, objective: string, index: number, now: string): UlwLoopItem;
export declare function appendGoalToPlan(plan: UlwLoopPlan, title: string, objective: string, now: string): UlwLoopItem;

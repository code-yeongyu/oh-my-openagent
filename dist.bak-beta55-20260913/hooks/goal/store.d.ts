import { type Goal, type GoalStoreRef, type GoalUpdate } from "./types";
export declare function goalFilePath(ref: GoalStoreRef): string;
export declare function ensureGoalStoreDir(baseDir: string): void;
export declare function readGoal(ref: GoalStoreRef): Goal | null;
export declare function writeGoal(ref: GoalStoreRef, goal: Goal | null): void;
export declare function clearGoal(ref: GoalStoreRef): boolean;
export declare function createGoal(ref: GoalStoreRef, objective: string): Goal;
export declare function updateGoal(ref: GoalStoreRef, update: GoalUpdate): Goal | null;

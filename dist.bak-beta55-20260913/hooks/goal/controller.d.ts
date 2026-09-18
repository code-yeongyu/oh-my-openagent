import type { Goal, GoalStatus, TokenUsageSnapshot } from "./types";
export type GoalControllerOptions = {
    readonly projectDir: string;
};
export type TuiLoopSnapshot = {
    readonly version: 1;
    readonly activeGoalId: string | undefined;
    readonly goals: readonly {
        readonly id: string;
        readonly title: string;
        readonly status: "in_progress" | "complete";
        readonly successCriteria: readonly [];
    }[];
};
export type GoalController = ReturnType<typeof createGoalController>;
export declare function createGoalController(options: GoalControllerOptions): {
    setGoal(sessionID: string, rawObjective: string): Goal;
    getGoal(sessionID: string): Goal | null;
    pauseGoal(sessionID: string): Goal | null;
    resumeGoal(sessionID: string): Goal | null;
    clearGoal(sessionID: string): boolean;
    markComplete(sessionID: string): Goal | null;
    accountUsage(sessionID: string, usage: TokenUsageSnapshot, elapsedSeconds: number): Goal | null;
    updateTui(sessionID: string): void;
};
export declare function goalStatusForTui(status: GoalStatus): "in_progress" | "complete";

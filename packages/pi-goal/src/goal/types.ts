export const GOAL_STATUS_VALUES = ["active", "paused", "blocked", "budgetLimited", "complete"] as const;
export const COMPLETABLE_GOAL_STATUS_VALUES = ["complete", "blocked"] as const;

export type GoalStatus = (typeof GOAL_STATUS_VALUES)[number];
export type CompletableGoalStatus = (typeof COMPLETABLE_GOAL_STATUS_VALUES)[number];

export type GoalStoreRef = {
	baseDir: string;
	threadId: string;
};

export type GoalAccountingMode = "activeStatusOnly" | "active" | "activeOrComplete" | "activeOrStopped";

export type Goal = {
	id: string;
	threadId: string;
	objective: string;
	status: GoalStatus;
	tokenBudget?: number;
	tokensUsed: number;
	timeUsedSeconds: number;
	createdAt: number;
	updatedAt: number;
	lastStartedAt?: number;
	completedAt?: number;
};

export type GoalFile = {
	version: 1;
	goal: Goal | null;
};

export type TokenUsageSnapshot = {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	totalTokens: number;
};

export type GoalUpdate = {
	objective?: string;
	status?: GoalStatus;
	tokenBudget?: number | null;
};

export type GoalToolSnapshot = {
	threadId: string;
	objective: string;
	status: GoalStatus;
	tokenBudget?: number;
	tokensUsed: number;
	timeUsedSeconds: number;
	createdAt: number;
	updatedAt: number;
};

export type GoalToolResponse = {
	goal: GoalToolSnapshot | null;
	remainingTokens: number | null;
	completionBudgetReport: string | null;
};

export function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}

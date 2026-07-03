import type { Goal, GoalStatus, GoalToolResponse, GoalToolSnapshot } from "./types.ts";

export function formatGoalElapsedSeconds(value: number): string {
	const seconds = Math.max(0, Math.trunc(value));
	if (seconds < 60) return `${seconds}s`;

	const minutes = Math.trunc(seconds / 60);
	if (minutes < 60) return `${minutes}m`;

	const hours = Math.trunc(minutes / 60);
	const remainingMinutes = minutes % 60;
	if (hours >= 24) {
		const days = Math.trunc(hours / 24);
		const remainingHours = hours % 24;
		return `${days}d ${remainingHours}h ${remainingMinutes}m`;
	}

	if (remainingMinutes === 0) return `${hours}h`;
	return `${hours}h ${remainingMinutes}m`;
}

export function formatTokensCompact(value: number): string {
	const abs = Math.abs(value);
	if (abs >= 1_000_000) return `${formatOneDecimal(value / 1_000_000)}M`;
	if (abs >= 1_000) return `${formatOneDecimal(value / 1_000)}K`;
	return `${Math.trunc(value)}`;
}

export function goalStatusLabel(status: GoalStatus): string {
	switch (status) {
		case "active":
			return "active";
		case "paused":
			return "paused";
		case "complete":
			return "complete";
	}
}

export function formatGoalForTool(goal: Goal | null): string {
	if (!goal) return "No active goal is set.";
	const lines = [
		`Objective: ${goal.objective}`,
		`Status: ${goalStatusLabel(goal.status)}`,
		`Time used: ${formatGoalElapsedSeconds(goal.timeUsedSeconds)}`,
		`Tokens used: ${formatTokensCompact(goal.tokensUsed)}`,
	];
	if (goal.completedAt) lines.push(`Completed at: ${new Date(goal.completedAt * 1000).toISOString()}`);
	return lines.join("\n");
}

export function goalToolResponse(goal: Goal | null): GoalToolResponse {
	return { goal: goal === null ? null : goalToolSnapshot(goal) };
}

export function formatGoalToolResponse(goal: Goal | null): string {
	return JSON.stringify(goalToolResponse(goal), null, 2);
}

function goalToolSnapshot(goal: Goal): GoalToolSnapshot {
	return {
		threadId: goal.threadId,
		objective: goal.objective,
		status: goal.status,
		tokensUsed: goal.tokensUsed,
		timeUsedSeconds: goal.timeUsedSeconds,
		createdAt: goal.createdAt,
		updatedAt: goal.updatedAt,
	};
}

function formatOneDecimal(value: number): string {
	const rounded = value.toFixed(1);
	return rounded.endsWith(".0") ? rounded.slice(0, -2) : rounded;
}

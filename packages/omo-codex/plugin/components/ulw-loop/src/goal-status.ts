import { type UlwLoopScope, ulwLoopGoalsRelativePath, ulwLoopLedgerRelativePath } from "./paths.js";
import type {
	UlwLoopCodexGoalMode,
	UlwLoopItem,
	UlwLoopPlan,
	UlwLoopStatus,
	UlwLoopSuccessCriterion,
} from "./types.js";

export const ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE: string = aggregateCodexObjectiveForScope();

export function aggregateCodexObjectiveForScope(scope?: UlwLoopScope): string {
	return `Complete the durable ulw-loop plan in ${ulwLoopGoalsRelativePath(scope)}, including later accepted/appended stories, under the original brief constraints; use ${ulwLoopLedgerRelativePath(scope)} as the audit trail.`;
}

export function codexGoalMode(plan: UlwLoopPlan): UlwLoopCodexGoalMode {
	return plan.codexGoalMode ?? "per_story";
}

function isResolvedStatus(status: UlwLoopStatus): boolean {
	return status === "complete";
}

function isSupersededResolved(goal: UlwLoopItem, plan: UlwLoopPlan): boolean {
	if (goal.steeringStatus !== "superseded") return false;
	const replacements = goal.supersededBy ?? [];
	if (replacements.length === 0) return false;
	return replacements.every((id) => {
		const replacement = plan.goals.find((candidate) => candidate.id === id);
		return replacement !== undefined && isResolvedStatus(replacement.status);
	});
}

function isCompletionBlocking(goal: UlwLoopItem, plan: UlwLoopPlan): boolean {
	if (goal.steeringStatus === "superseded") return !isSupersededResolved(goal, plan);
	if (goal.steeringStatus === "blocked") return true;
	return !isResolvedStatus(goal.status);
}

function isCompletionBlockingForFinalCandidate(
	candidate: UlwLoopItem,
	finalCandidate: UlwLoopItem,
	plan: UlwLoopPlan,
): boolean {
	if (candidate.id === finalCandidate.id) return false;
	if (candidate.steeringStatus === "superseded") {
		const replacements = candidate.supersededBy ?? [];
		if (replacements.length === 0) return true;
		return !replacements.every((id) => {
			if (id === finalCandidate.id) return true;
			const replacement = plan.goals.find((goal) => goal.id === id);
			return replacement !== undefined && isResolvedStatus(replacement.status);
		});
	}
	return isCompletionBlocking(candidate, plan);
}

export function isUlwLoopDone(plan: UlwLoopPlan): boolean {
	if (plan.aggregateCompletion?.status === "complete") return true;
	return plan.goals.every((goal) => !isCompletionBlocking(goal, plan));
}

export function isFinalRunCompletionCandidate(plan: UlwLoopPlan, goal: UlwLoopItem): boolean {
	return (
		isCompletionBlocking(goal, plan) &&
		plan.goals.every((candidate) => !isCompletionBlockingForFinalCandidate(candidate, goal, plan))
	);
}

export function aggregateCodexObjective(plan: UlwLoopPlan): string {
	return plan.codexObjective ?? ULW_LOOP_AGGREGATE_CODEX_OBJECTIVE;
}

export function expectedCodexObjective(plan: UlwLoopPlan, goal: UlwLoopItem): string {
	return codexGoalMode(plan) === "aggregate" ? aggregateCodexObjective(plan) : goal.objective;
}

export function compatibleCodexObjectives(plan: UlwLoopPlan): readonly string[] {
	return [aggregateCodexObjective(plan), ...(plan.codexObjectiveAliases ?? [])];
}

export function hasAllCriteriaPass(goal: UlwLoopItem): boolean {
	return goal.successCriteria.length > 0 && goal.successCriteria.every((criterion) => criterion.status === "pass");
}

export function firstUnresolvedCriterion(goal: UlwLoopItem): UlwLoopSuccessCriterion | undefined {
	return goal.successCriteria.find((criterion) => criterion.status !== "pass");
}

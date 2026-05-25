import type {
	UltragoalCodexGoalMode,
	UltragoalItem,
	UltragoalPlan,
	UltragoalStatus,
	UltragoalSuccessCriterion,
} from "./types.js";

export const ULTRAGOAL_AGGREGATE_CODEX_OBJECTIVE: string =
	"Complete the durable ultragoal plan in .omo/ultragoal/goals.json, including later accepted/appended stories, under the original brief constraints; use .omo/ultragoal/ledger.jsonl as the audit trail.";

export function codexGoalMode(plan: UltragoalPlan): UltragoalCodexGoalMode {
	return plan.codexGoalMode ?? "per_story";
}

function isResolvedStatus(status: UltragoalStatus): boolean {
	return status === "complete";
}

function isSupersededResolved(goal: UltragoalItem, plan: UltragoalPlan): boolean {
	if (goal.steeringStatus !== "superseded") return false;
	const replacements = goal.supersededBy ?? [];
	if (replacements.length === 0) return false;
	return replacements.every((id) => {
		const replacement = plan.goals.find((candidate) => candidate.id === id);
		return replacement !== undefined && isResolvedStatus(replacement.status);
	});
}

function isCompletionBlocking(goal: UltragoalItem, plan: UltragoalPlan): boolean {
	if (goal.steeringStatus === "superseded") return !isSupersededResolved(goal, plan);
	if (goal.steeringStatus === "blocked") return true;
	return !isResolvedStatus(goal.status);
}

function isCompletionBlockingForFinalCandidate(
	candidate: UltragoalItem,
	finalCandidate: UltragoalItem,
	plan: UltragoalPlan,
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

export function isUltragoalDone(plan: UltragoalPlan): boolean {
	if (plan.aggregateCompletion?.status === "complete") return true;
	return plan.goals.every((goal) => !isCompletionBlocking(goal, plan));
}

export function isFinalRunCompletionCandidate(plan: UltragoalPlan, goal: UltragoalItem): boolean {
	return (
		isCompletionBlocking(goal, plan) &&
		plan.goals.every((candidate) => !isCompletionBlockingForFinalCandidate(candidate, goal, plan))
	);
}

export function aggregateCodexObjective(plan: UltragoalPlan): string {
	return plan.codexObjective ?? ULTRAGOAL_AGGREGATE_CODEX_OBJECTIVE;
}

export function expectedCodexObjective(plan: UltragoalPlan, goal: UltragoalItem): string {
	return codexGoalMode(plan) === "aggregate" ? aggregateCodexObjective(plan) : goal.objective;
}

export function compatibleCodexObjectives(plan: UltragoalPlan): readonly string[] {
	return [aggregateCodexObjective(plan), ...(plan.codexObjectiveAliases ?? [])];
}

export function hasAllCriteriaPass(goal: UltragoalItem): boolean {
	return goal.successCriteria.length > 0 && goal.successCriteria.every((criterion) => criterion.status === "pass");
}

export function firstUnresolvedCriterion(goal: UltragoalItem): UltragoalSuccessCriterion | undefined {
	return goal.successCriteria.find((criterion) => criterion.status !== "pass");
}

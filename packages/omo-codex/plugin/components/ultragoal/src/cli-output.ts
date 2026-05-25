import type { UltragoalCodexGoalMode, UltragoalItem, UltragoalPlan } from "./types.js";
import { UltragoalError } from "./types.js";

export const ULTRAGOAL_HELP = `Usage:
  omo ultragoal create-goals --brief "..." [--brief-file <path>] [--from-stdin] [--codex-goal-mode aggregate|per_story] [--force] [--json]
  omo ultragoal status [--json]
  omo ultragoal complete-goals [--retry-failed] [--json]
  omo ultragoal criteria --goal-id <id> [--json]
  omo ultragoal record-evidence --goal-id <id> --criterion-id <id> --status pass|fail|blocked --evidence "..." [--notes "..."] [--json]
  omo ultragoal checkpoint --goal-id <id> --status complete|failed|blocked --evidence "..." --codex-goal-json <...> [--quality-gate-json <...>] [--json]
  omo ultragoal steer --kind <kind> ... --evidence "..." --rationale "..." [--json]
  omo ultragoal add-goal --title "..." --objective "..." [--json]
  omo ultragoal record-review-blockers --goal-id <id> --title "..." --objective "..." --evidence "..." --codex-goal-json <...> [--json]`;

type CriteriaCounts = { readonly pass: number; readonly total: number };

export function printJson(value: unknown): void {
	process.stdout.write(`${JSON.stringify(value, null, 2)}\n`);
}

function criteriaCounts(goal: UltragoalItem): CriteriaCounts {
	let pass = 0;
	for (const criterion of goal.successCriteria) if (criterion.status === "pass") pass += 1;
	return { pass, total: goal.successCriteria.length };
}

export function printStatus(plan: UltragoalPlan): void {
	let totalCriteria = 0;
	let passCriteria = 0;
	const lines = ["ultragoal status", "", "goals:"];
	for (const goal of plan.goals) {
		const counts = criteriaCounts(goal);
		totalCriteria += counts.total;
		passCriteria += counts.pass;
		const marker = goal.id === plan.activeGoalId ? "*" : "-";
		lines.push(`${marker} ${goal.id} [${goal.status}] ${goal.title} (criteria: ${counts.pass}/${counts.total})`);
	}
	lines.push("", "summary:", `total goals: ${plan.goals.length}`, `criteria: ${passCriteria}/${totalCriteria} pass`);
	process.stdout.write(`${lines.join("\n")}\n`);
}

export function blockedDecisionHandoff(plan: UltragoalPlan): string {
	const blocked = plan.goals.find((goal) => goal.status === "needs_user_decision" && goal.nonRetriable);
	if (blocked === undefined) return "";
	return [
		"ultragoal: blocked on repeated external authorization; no retryable failed goals remain.",
		`Goal: ${blocked.id} - ${blocked.title}`,
		`Required external decision: ${blocked.requiredExternalDecision ?? "provide the missing authorization or choose a different unblock path"}.`,
		"Do not run complete-goals --retry-failed again until external state changes or the user authorizes an unblock path.",
	].join("\n");
}

export function normalizeCodexGoalMode(value: string | undefined): UltragoalCodexGoalMode {
	if (value === undefined) return "aggregate";
	if (value === "aggregate" || value === "per_story") return value;
	throw new UltragoalError(
		"Invalid --codex-goal-mode; expected aggregate or per_story.",
		"ULTRAGOAL_CODEX_GOAL_MODE_INVALID",
		{ details: { value } },
	);
}

import { hasAllCriteriaPass, isFinalRunCompletionCandidate } from "./goal-status.js";
import { ULW_LOOP_CREATE_GOALS_COMMAND } from "./plan-missing-recovery.js";
import type { UlwLoopItem, UlwLoopPlan } from "./types.js";

/**
 * `status --json` is the one call every agent already makes between steps, so it is
 * also the cheapest place to answer "what now?" without a second round trip.
 */
export function statusNextActions(plan: UlwLoopPlan): readonly string[] {
	const actions: string[] = [];
	const active = plan.goals.find((goal) => goal.id === plan.activeGoalId);
	if (plan.goals.length === 0) actions.push(`No goals yet: bootstrap with \`${ULW_LOOP_CREATE_GOALS_COMMAND}\`.`);
	else if (active !== undefined) actions.push(...activeGoalActions(plan, active));
	for (const goal of plan.goals.filter((candidate) => candidate.status === "review_blocked"))
		actions.push(
			`${goal.id} is review_blocked: capture the reviewer verdict with \`omo-agent-toolkit ulw-loop record-review-blockers --goal-id ${goal.id} --title "<title>" --objective "<objective>" --evidence "<verdict>" --codex-goal-json '<get_goal json>'\`.`,
		);
	if (plan.evidenceLayoutVersion !== 2 || active === undefined)
		actions.push("plan is evidence-layout v1; artifacts go under .omo/evidence/");
	return actions;
}

function activeGoalActions(plan: UlwLoopPlan, active: UlwLoopItem): readonly string[] {
	const unresolved = active.successCriteria.filter((criterion) => criterion.status !== "pass");
	if (unresolved.length > 0)
		return [
			`${active.id} has ${unresolved.length} unresolved criterion(s) (${unresolved.map((criterion) => criterion.id).join(", ")}): record proof with \`omo-agent-toolkit ulw-loop record-evidence --goal-id ${active.id} --criterion-id <id> --status pass --evidence "<observable proof>"\`.`,
		];
	if (hasAllCriteriaPass(active) && isFinalRunCompletionCandidate(plan, active))
		return [
			`${active.id} passes every criterion and is the final story: update_goal complete, then checkpoint --print-template to build the final quality gate.`,
		];
	return [
		`${active.id} passes every criterion: close it with \`omo-agent-toolkit ulw-loop checkpoint --goal-id ${active.id} --status complete --evidence "<proof>" --codex-goal-json '<get_goal json>'\`.`,
	];
}

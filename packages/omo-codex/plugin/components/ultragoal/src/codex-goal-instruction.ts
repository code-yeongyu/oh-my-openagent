import { codexGoalMode, expectedCodexObjective, isFinalRunCompletionCandidate } from "./goal-status.js";
import type { UltragoalCodexGoalMode, UltragoalItem, UltragoalPlan, UltragoalSuccessCriterion } from "./types.js";

export interface CodexCreateGoalPayload {
	readonly objective: string;
	readonly status: "active";
}

export interface UltragoalGoalInstruction {
	readonly text: string;
	readonly json: CodexCreateGoalPayload;
}

export function buildCodexGoalInstruction(args: {
	readonly plan: UltragoalPlan;
	readonly goal: UltragoalItem;
	readonly isFinal?: boolean;
}): UltragoalGoalInstruction {
	const mode = codexGoalMode(args.plan);
	const createGoal = buildCreateGoalPayload(args.plan, args.goal);
	const isFinal = args.isFinal ?? isFinalRunCompletionCandidate(args.plan, args.goal);
	return { text: buildText(mode, args.plan, args.goal, createGoal, isFinal), json: createGoal };
}

function buildCreateGoalPayload(plan: UltragoalPlan, goal: UltragoalItem): CodexCreateGoalPayload {
	return { objective: expectedCodexObjective(plan, goal), status: "active" };
}

function buildText(
	mode: UltragoalCodexGoalMode,
	plan: UltragoalPlan,
	goal: UltragoalItem,
	createGoal: CodexCreateGoalPayload,
	isFinal: boolean,
): string {
	return joinLines([
		mode === "aggregate" ? "Ultragoal aggregate-goal handoff" : "Ultragoal active-goal handoff",
		`Mode: ${mode}`,
		`Plan: ${plan.goalsPath}`,
		`Ledger: ${plan.ledgerPath}`,
		`Goal: ${goal.id} — ${goal.title}`,
		"",
		...activeGoalLines(goal),
		"",
		...successCriteriaLines(goal.successCriteria),
		"",
		"Codex goal integration constraints:",
		"- Use the create_goal payload exactly as rendered: objective and status only.",
		"- Goals are unlimited. Do not add numeric limits.",
		...modeConstraintLines(mode, isFinal),
		finalSection(goal, isFinal, mode === "aggregate"),
		...checkpointLines(mode),
		"",
		"create_goal payload:",
		JSON.stringify(createGoal, null, 2),
	]);
}

function modeConstraintLines(mode: UltragoalCodexGoalMode, isFinal: boolean): readonly string[] {
	if (mode === "per_story") {
		return [
			"- First call get_goal. If no active goal exists, call create_goal with the payload below.",
			"- If a different active Codex goal exists, finish/checkpoint that goal before starting this ultragoal.",
			"- Work only this goal until its completion audit passes.",
		];
	}
	return [
		"- Codex goal = the whole omo ultragoal run; OMO G001/G002/etc. = ledger stories.",
		"- First call get_goal. If no active goal exists, call create_goal with the aggregate payload below.",
		"- If get_goal reports the same aggregate objective as active, continue this OMO story without creating a new Codex goal.",
		"- If a different active or incomplete Codex goal exists, finish/checkpoint that goal before starting this ultragoal.",
		isFinal
			? "- This is the final story; update_goal is allowed only after the mandatory quality gate passes."
			: "- This is not the final story: do not call update_goal yet; the aggregate Codex goal must remain active while later OMO stories remain.",
	];
}

function checkpointLines(mode: UltragoalCodexGoalMode): readonly string[] {
	const failureLine =
		"- If blocked or failed, checkpoint with --status failed and the failure evidence; rerun complete-goals --retry-failed to resume.";
	if (mode === "per_story") return [failureLine];
	return [
		"- Checkpoint this OMO story with a fresh get_goal snapshot whose objective matches the aggregate payload.",
		failureLine,
	];
}

function activeGoalLines(goal: UltragoalItem): readonly string[] {
	return ["Active goal:", `- id: ${goal.id}`, `- title: ${goal.title}`, `- objective: ${goal.objective}`];
}

function successCriteriaLines(criteria: readonly UltragoalSuccessCriterion[]): readonly string[] {
	if (criteria.length === 0) return ["Success criteria:", "- No success criteria recorded for this goal."];
	return ["Success criteria:", ...criteria.map(formatCriterionLine)];
}

function formatCriterionLine(criterion: UltragoalSuccessCriterion): string {
	const remainingWork = criterion.status === "pending" ? " remaining work:" : "";
	return `-${remainingWork} [${criterion.id}] (${criterion.userModel}) ${criterion.scenario} — expect: ${criterion.expectedEvidence} — status: ${criterion.status}`;
}

function finalSection(goal: UltragoalItem, isFinal: boolean, aggregate: boolean): string {
	if (!isFinal)
		return "- This is not the final ultragoal story; do not run the final ai-slop-cleaner/$code-review gate yet.";
	const blockerCommand = `omo ultragoal record-review-blockers --goal-id ${goal.id} --title "Resolve final code-review blockers" --objective "<blocker-resolution objective>" --evidence "<review findings>" --codex-goal-json "<active get_goal JSON or path>"`;
	const checkpointCommand = `omo ultragoal checkpoint --goal-id ${goal.id} --status complete --evidence "<tests/files/PR evidence>" --codex-goal-json "<fresh complete get_goal JSON or path>" --quality-gate-json "<quality gate JSON or path>"`;
	return joinLines([
		"Final story — run mandatory quality gate before update_goal:",
		"- Run ai-slop-cleaner on changed files even when it is a no-op, rerun verification, then run $code-review.",
		"- If final $code-review is not APPROVE with architect status CLEAR, do not call update_goal. Record blocker work first:",
		`  ${blockerCommand}`,
		aggregate
			? '- If final $code-review is clean, call update_goal({status: "complete"}), call get_goal again, then checkpoint the aggregate story:'
			: '- If final $code-review is clean, call update_goal({status: "complete"}), call get_goal again, then checkpoint:',
		`  ${checkpointCommand}`,
	]);
}

function joinLines(lines: readonly string[]): string {
	return lines.join("\n");
}

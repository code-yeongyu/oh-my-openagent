import { readFile } from "node:fs/promises";

import { type CheckpointUlwLoopArgs, checkpointUlwLoop } from "./checkpoint.js";
import {
	hasFlag,
	parseCodexGoalJson,
	parseRecordEvidenceArgs,
	positionalText,
	readStdin,
	readValue,
} from "./cli-arg-parser.js";
import { blockedDecisionHandoff, normalizeCodexGoalMode, printJson, printStatus } from "./cli-output.js";
import { parseSteeringProposal, printSteerResult } from "./cli-steering.js";
import { buildCodexGoalInstruction } from "./codex-goal-instruction.js";
import { recordEvidence } from "./evidence.js";
import { isEssentialCriterion } from "./goal-status.js";
import { type UlwLoopScope, ulwLoopAttemptEvidenceDir } from "./paths.js";
import { addUlwLoopGoal, createUlwLoopPlan, startNextUlwLoop, summarizeUlwLoopPlan } from "./plan-crud.js";
import { readUlwLoopPlan } from "./plan-io.js";
import { recordFinalReviewBlockers } from "./review-blockers.js";
import { steerUlwLoop } from "./steering.js";
import type { UlwLoopItem } from "./types.js";
import { UlwLoopError } from "./types.js";

type CheckpointStatus = "complete" | "failed" | "blocked";

export async function createGoals(
	repoRoot: string,
	argv: readonly string[],
	json: boolean,
	scope?: UlwLoopScope,
): Promise<number> {
	const briefFile = readValue(argv, "--brief-file");
	const brief =
		readValue(argv, "--brief") ??
		(briefFile === undefined ? undefined : await readFile(briefFile, "utf8")) ??
		(hasFlag(argv, "--from-stdin") ? await readStdin() : undefined) ??
		positionalText(argv);
	if (!brief.trim()) {
		throw new UlwLoopError(
			"Missing brief text. Pass --brief, --brief-file, --from-stdin, or positional text.",
			"ULW_LOOP_BRIEF_REQUIRED",
		);
	}
	const plan = await createUlwLoopPlan(
		repoRoot,
		{
			brief,
			codexGoalMode: normalizeCodexGoalMode(readValue(argv, "--codex-goal-mode")),
			force: hasFlag(argv, "--force"),
		},
		scope,
	);
	if (json) printJson({ ok: true, plan, summary: summarizeUlwLoopPlan(plan) });
	else {
		process.stdout.write(
			`ulw-loop plan created: ${plan.goals.length} goal(s)\nbrief: ${plan.briefPath}\ngoals: ${plan.goalsPath}\nledger: ${plan.ledgerPath}\n`,
		);
	}
	return 0;
}

export async function status(repoRoot: string, json: boolean, scope?: UlwLoopScope): Promise<number> {
	const plan = await readUlwLoopPlan(repoRoot, scope);
	if (json) {
		const active = plan.goals.find((goal) => goal.id === plan.activeGoalId);
		const currentAttemptDir =
			plan.evidenceLayoutVersion === 2 && active
				? ulwLoopAttemptEvidenceDir(active.id, active.attempt, scope)
				: undefined;
		printJson({
			ok: true,
			plan,
			summary: summarizeUlwLoopPlan(plan),
			...(currentAttemptDir === undefined ? {} : { currentAttemptDir }),
		});
	} else printStatus(plan);
	return 0;
}

export async function completeGoals(
	repoRoot: string,
	argv: readonly string[],
	json: boolean,
	scope?: UlwLoopScope,
): Promise<number> {
	const result = await startNextUlwLoop(repoRoot, { retryFailed: hasFlag(argv, "--retry-failed") }, scope);
	if ("done" in result) {
		const handoff = blockedDecisionHandoff(result.plan);
		if (json) {
			printJson({
				ok: true,
				done: true,
				blocked: handoff.length > 0,
				handoff,
				summary: summarizeUlwLoopPlan(result.plan),
				plan: result.plan,
			});
		} else process.stdout.write(`${handoff || "ulw-loop: all goals complete"}\n`);
		return 0;
	}
	const instruction = buildCodexGoalInstruction({ plan: result.plan, goal: result.goal });
	if (json) printJson({ ok: true, resumed: result.resumed, goal: result.goal, instruction, plan: result.plan });
	else process.stdout.write(`${instruction.text}\n`);
	return 0;
}

export async function checkpoint(
	repoRoot: string,
	argv: readonly string[],
	json: boolean,
	scope?: UlwLoopScope,
): Promise<number> {
	const goalId = required(argv, "--goal-id");
	const statusValue = checkpointStatus(required(argv, "--status"));
	const evidence = required(argv, "--evidence");
	const codexGoalJson = await parseCodexGoalJson(
		statusValue === "complete" ? required(argv, "--codex-goal-json") : readValue(argv, "--codex-goal-json"),
	);
	if (statusValue === "complete" && codexGoalJson === undefined) {
		throw new UlwLoopError("Missing --codex-goal-json.", "ULW_LOOP_CODEX_GOAL_JSON_REQUIRED");
	}
	const qualityGateJson = readValue(argv, "--quality-gate-json");
	const args: CheckpointUlwLoopArgs = {
		goalId,
		status: statusValue,
		evidence,
		...(codexGoalJson === undefined ? {} : { codexGoalJson }),
		...(qualityGateJson === undefined ? {} : { qualityGateJson }),
	};
	const result = await checkpointUlwLoop(repoRoot, args, scope);
	if (json) printJson({ ok: true, ...result, summary: summarizeUlwLoopPlan(result.plan) });
	else process.stdout.write(`ulw-loop checkpoint: ${result.goal.id} -> ${result.goal.status}\n`);
	return 0;
}

export async function steer(
	repoRoot: string,
	argv: readonly string[],
	json: boolean,
	scope?: UlwLoopScope,
): Promise<number> {
	const proposal = await parseSteeringProposal(argv);
	const result = await steerUlwLoop(repoRoot, proposal, scope);
	printSteerResult(result, json);
	return result.accepted ? 0 : 1;
}

export async function addGoal(
	repoRoot: string,
	argv: readonly string[],
	json: boolean,
	scope?: UlwLoopScope,
): Promise<number> {
	const result = await addUlwLoopGoal(
		repoRoot,
		{ title: required(argv, "--title"), objective: required(argv, "--objective") },
		scope,
	);
	if (json) printJson({ ok: true, plan: result.plan, goal: result.goal, summary: summarizeUlwLoopPlan(result.plan) });
	else {
		process.stdout.write(`ulw-loop added goal: ${result.goal.id}\n`);
		printStatus(result.plan);
	}
	return 0;
}

export async function criteria(
	repoRoot: string,
	argv: readonly string[],
	json: boolean,
	scope?: UlwLoopScope,
): Promise<number> {
	const goalId = required(argv, "--goal-id");
	const goal = findGoal(await readUlwLoopPlan(repoRoot, scope), goalId);
	if (json) printJson({ ok: true, goalId: goal.id, criteria: goal.successCriteria });
	else {
		process.stdout.write(`criteria for ${goal.id}:\n${goal.successCriteria.map(formatCriterionForCli).join("\n")}\n`);
	}
	return 0;
}

export async function captureEvidence(
	repoRoot: string,
	argv: readonly string[],
	json: boolean,
	scope?: UlwLoopScope,
): Promise<number> {
	const result = await recordEvidence(repoRoot, parseRecordEvidenceArgs(argv), scope);
	if (json) printJson({ ok: true, ...result, summary: summarizeUlwLoopPlan(result.plan) });
	else {
		process.stdout.write(
			`ulw-loop evidence recorded: ${result.goal.id}/${result.criterion.id} -> ${result.criterion.status}\n`,
		);
	}
	return 0;
}

export async function reviewBlockers(
	repoRoot: string,
	argv: readonly string[],
	json: boolean,
	scope?: UlwLoopScope,
): Promise<number> {
	const codexGoalJson = await parseCodexGoalJson(required(argv, "--codex-goal-json"));
	if (codexGoalJson === undefined) {
		throw new UlwLoopError("Missing --codex-goal-json.", "ULW_LOOP_CODEX_GOAL_JSON_REQUIRED");
	}
	const result = await recordFinalReviewBlockers(
		repoRoot,
		{
			goalId: required(argv, "--goal-id"),
			title: required(argv, "--title"),
			objective: required(argv, "--objective"),
			evidence: required(argv, "--evidence"),
			codexGoalJson,
		},
		scope,
	);
	if (json) {
		printJson({
			ok: true,
			plan: result.plan,
			blockedGoal: result.blockedGoal,
			goal: result.newGoal,
			ledgerEntries: result.ledgerEntries,
			summary: summarizeUlwLoopPlan(result.plan),
		});
	} else {
		process.stdout.write(
			`ulw-loop final review blockers recorded: ${result.blockedGoal.id} -> review_blocked; added ${result.newGoal.id}\n`,
		);
	}
	return 0;
}

function formatCriterionForCli(criterion: UlwLoopItem["successCriteria"][number]): string {
	const marker = isEssentialCriterion(criterion) ? "essential" : "non-essential";
	return `- ${criterion.id} [${criterion.status}] [${marker}] (${criterion.userModel}) ${criterion.scenario} evidence: ${criterion.capturedEvidence ?? "pending"}`;
}

function required(argv: readonly string[], flag: string): string {
	const value = readValue(argv, flag)?.trim();
	if (value) return value;
	throw new UlwLoopError(`Missing ${flag}.`, "ULW_LOOP_ARGUMENT_MISSING", { details: { flag } });
}

function checkpointStatus(value: string): CheckpointStatus {
	if (value === "complete" || value === "failed" || value === "blocked") return value;
	throw new UlwLoopError(
		"Missing or invalid --status; expected complete, failed, or blocked.",
		"ULW_LOOP_STATUS_INVALID",
		{ details: { status: value } },
	);
}

function findGoal(plan: { readonly goals: readonly UlwLoopItem[] }, goalId: string): UlwLoopItem {
	const goal = plan.goals.find((candidate) => candidate.id === goalId);
	if (goal !== undefined) return goal;
	throw new UlwLoopError(`Unknown ulw-loop id: ${goalId}.`, "ULW_LOOP_GOAL_NOT_FOUND", { details: { goalId } });
}

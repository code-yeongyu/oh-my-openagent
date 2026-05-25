// biome-ignore-all format: keep cli-commands dispatcher under the 200 pure LOC budget.
import { readFile } from "node:fs/promises";
import { checkpointUltragoal } from "./checkpoint.js";
import { hasFlag, parseCodexGoalJson, parseRecordEvidenceArgs, positionalText, readStdin, readValue } from "./cli-arg-parser.js";
import { blockedDecisionHandoff, normalizeCodexGoalMode, printJson, printStatus, ULTRAGOAL_HELP } from "./cli-output.js";
import { parseSteeringProposal, printSteerResult } from "./cli-steering.js";
import { buildCodexGoalInstruction } from "./codex-goal-instruction.js";
import { recordEvidence } from "./evidence.js";
import { addUltragoalGoal, createUltragoalPlan, startNextUltragoal, summarizeUltragoalPlan } from "./plan-crud.js";
import { readUltragoalPlan } from "./plan-io.js";
import { recordFinalReviewBlockers } from "./review-blockers.js";
import { steerUltragoal } from "./steering.js";
import type { UltragoalItem } from "./types.js";
import { UltragoalError } from "./types.js";

type CheckpointStatus = "complete" | "failed" | "blocked";

export async function ultragoalCommand(argv: readonly string[]): Promise<number> {
	const command = argv[0] ?? "help";
	const rest = argv.slice(1);
	const repoRoot = process.cwd();
	const json = hasFlag(rest, "--json");
	try {
		switch (command) {
			case "help": case "--help": case "-h": process.stdout.write(`${ULTRAGOAL_HELP}\n`); return 0;
			case "create-goals": return await createGoals(repoRoot, rest, json);
			case "status": return await status(repoRoot, json);
			case "complete-goals": return await completeGoals(repoRoot, rest, json);
			case "checkpoint": return await checkpoint(repoRoot, rest, json);
			case "steer": return await steer(repoRoot, rest, json);
			case "add-goal": return await addGoal(repoRoot, rest, json);
			case "criteria": return await criteria(repoRoot, rest, json);
			case "record-evidence": return await captureEvidence(repoRoot, rest, json);
			case "record-review-blockers": return await reviewBlockers(repoRoot, rest, json);
			default: process.stdout.write(`${ULTRAGOAL_HELP}\n`); return 1;
		}
	} catch (error) {
		if (error instanceof UltragoalError) process.stderr.write(`[ultragoal] ${error.message}\n`);
		else if (error instanceof Error) process.stderr.write(`[ultragoal] unexpected: ${error.message}\n`);
		else process.stderr.write("[ultragoal] unknown error\n");
		return 1;
	}
}

async function createGoals(repoRoot: string, argv: readonly string[], json: boolean): Promise<number> {
	const briefFile = readValue(argv, "--brief-file");
	const brief = readValue(argv, "--brief") ?? (briefFile === undefined ? undefined : await readFile(briefFile, "utf8")) ?? (hasFlag(argv, "--from-stdin") ? await readStdin() : undefined) ?? positionalText(argv);
	if (!brief.trim()) throw new UltragoalError("Missing brief text. Pass --brief, --brief-file, --from-stdin, or positional text.", "ULTRAGOAL_BRIEF_REQUIRED");
	const plan = await createUltragoalPlan(repoRoot, { brief, codexGoalMode: normalizeCodexGoalMode(readValue(argv, "--codex-goal-mode")), force: hasFlag(argv, "--force") });
	if (json) printJson({ ok: true, plan, summary: summarizeUltragoalPlan(plan) });
	else process.stdout.write(`ultragoal plan created: ${plan.goals.length} goal(s)\nbrief: ${plan.briefPath}\ngoals: ${plan.goalsPath}\nledger: ${plan.ledgerPath}\n`);
	return 0;
}

async function status(repoRoot: string, json: boolean): Promise<number> {
	const plan = await readUltragoalPlan(repoRoot);
	if (json) printJson({ ok: true, plan, summary: summarizeUltragoalPlan(plan) });
	else printStatus(plan);
	return 0;
}

async function completeGoals(repoRoot: string, argv: readonly string[], json: boolean): Promise<number> {
	const result = await startNextUltragoal(repoRoot, { retryFailed: hasFlag(argv, "--retry-failed") });
	if ("done" in result) {
		const handoff = blockedDecisionHandoff(result.plan);
		if (json) printJson({ ok: true, done: true, blocked: handoff.length > 0, handoff, summary: summarizeUltragoalPlan(result.plan), plan: result.plan });
		else process.stdout.write(`${handoff || "ultragoal: all goals complete"}\n`);
		return 0;
	}
	const instruction = buildCodexGoalInstruction({ plan: result.plan, goal: result.goal });
	if (json) printJson({ ok: true, resumed: result.resumed, goal: result.goal, instruction, plan: result.plan });
	else process.stdout.write(`${instruction.text}\n`);
	return 0;
}

async function checkpoint(repoRoot: string, argv: readonly string[], json: boolean): Promise<number> {
	const goalId = required(argv, "--goal-id");
	const statusValue = checkpointStatus(required(argv, "--status"));
	const evidence = required(argv, "--evidence");
	const codexGoalJson = await parseCodexGoalJson(required(argv, "--codex-goal-json"));
	if (codexGoalJson === undefined) throw new UltragoalError("Missing --codex-goal-json.", "ULTRAGOAL_CODEX_GOAL_JSON_REQUIRED");
	const qualityGateJson = readValue(argv, "--quality-gate-json");
	const result = await checkpointUltragoal(repoRoot, qualityGateJson === undefined ? { goalId, status: statusValue, evidence, codexGoalJson } : { goalId, status: statusValue, evidence, codexGoalJson, qualityGateJson });
	if (json) printJson({ ok: true, ...result, summary: summarizeUltragoalPlan(result.plan) });
	else process.stdout.write(`ultragoal checkpoint: ${result.goal.id} -> ${result.goal.status}\n`);
	return 0;
}

async function steer(repoRoot: string, argv: readonly string[], json: boolean): Promise<number> {
	const proposal = await parseSteeringProposal(argv);
	const result = await steerUltragoal(repoRoot, proposal);
	printSteerResult(result, json);
	return result.accepted ? 0 : 1;
}

async function addGoal(repoRoot: string, argv: readonly string[], json: boolean): Promise<number> {
	const result = await addUltragoalGoal(repoRoot, { title: required(argv, "--title"), objective: required(argv, "--objective") });
	if (json) printJson({ ok: true, plan: result.plan, goal: result.goal, summary: summarizeUltragoalPlan(result.plan) });
	else { process.stdout.write(`ultragoal added goal: ${result.goal.id}\n`); printStatus(result.plan); }
	return 0;
}

async function criteria(repoRoot: string, argv: readonly string[], json: boolean): Promise<number> {
	const goalId = required(argv, "--goal-id");
	const goal = findGoal(await readUltragoalPlan(repoRoot), goalId);
	if (json) printJson({ ok: true, goalId: goal.id, criteria: goal.successCriteria });
	else process.stdout.write(`criteria for ${goal.id}:\n${goal.successCriteria.map((c) => `- ${c.id} [${c.status}] (${c.userModel}) ${c.scenario} evidence: ${c.capturedEvidence ?? "pending"}`).join("\n")}\n`);
	return 0;
}

async function captureEvidence(repoRoot: string, argv: readonly string[], json: boolean): Promise<number> {
	const result = await recordEvidence(repoRoot, parseRecordEvidenceArgs(argv));
	if (json) printJson({ ok: true, ...result, summary: summarizeUltragoalPlan(result.plan) });
	else process.stdout.write(`ultragoal evidence recorded: ${result.goal.id}/${result.criterion.id} -> ${result.criterion.status}\n`);
	return 0;
}

async function reviewBlockers(repoRoot: string, argv: readonly string[], json: boolean): Promise<number> {
	const codexGoalJson = await parseCodexGoalJson(required(argv, "--codex-goal-json"));
	if (codexGoalJson === undefined) throw new UltragoalError("Missing --codex-goal-json.", "ULTRAGOAL_CODEX_GOAL_JSON_REQUIRED");
	const result = await recordFinalReviewBlockers(repoRoot, { goalId: required(argv, "--goal-id"), title: required(argv, "--title"), objective: required(argv, "--objective"), evidence: required(argv, "--evidence"), codexGoalJson });
	if (json) printJson({ ok: true, plan: result.plan, blockedGoal: result.blockedGoal, goal: result.newGoal, ledgerEntries: result.ledgerEntries, summary: summarizeUltragoalPlan(result.plan) });
	else process.stdout.write(`ultragoal final review blockers recorded: ${result.blockedGoal.id} -> review_blocked; added ${result.newGoal.id}\n`);
	return 0;
}

function required(argv: readonly string[], flag: string): string {
	const value = readValue(argv, flag)?.trim();
	if (value) return value;
	throw new UltragoalError(`Missing ${flag}.`, "ULTRAGOAL_ARGUMENT_MISSING", { details: { flag } });
}

function checkpointStatus(value: string): CheckpointStatus {
	if (value === "complete" || value === "failed" || value === "blocked") return value;
	throw new UltragoalError("Missing or invalid --status; expected complete, failed, or blocked.", "ULTRAGOAL_STATUS_INVALID", { details: { status: value } });
}

function findGoal(plan: { readonly goals: readonly UltragoalItem[] }, goalId: string): UltragoalItem {
	const goal = plan.goals.find((candidate) => candidate.id === goalId);
	if (goal !== undefined) return goal;
	throw new UltragoalError(`Unknown ultragoal id: ${goalId}.`, "ULTRAGOAL_GOAL_NOT_FOUND", { details: { goalId } });
}

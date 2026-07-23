import { type CheckpointUlwLoopArgs, type CheckpointUlwLoopResult, checkpointUlwLoop } from "./checkpoint.js";
import { hasFlag, parseCodexGoalJson, readValue } from "./cli-arg-parser.js";
import { blockedDecisionHandoff, printJson } from "./cli-output.js";
import { buildCodexGoalInstruction, type UlwLoopGoalInstruction } from "./codex-goal-instruction.js";
import type { UlwLoopScope } from "./paths.js";
import { startNextUlwLoop, summarizeUlwLoopPlan } from "./plan-crud.js";
import type { UlwLoopItem, UlwLoopPlan } from "./types.js";
import { UlwLoopError } from "./types.js";

type ContinuationNext =
	| { readonly resumed: boolean; readonly goal: UlwLoopItem; readonly instruction: UlwLoopGoalInstruction }
	| { readonly done: true; readonly blocked: boolean; readonly handoff: string };

export type CheckpointAndContinueResult = CheckpointUlwLoopResult & { readonly next?: ContinuationNext };

export async function checkpointAndContinue(
	repoRoot: string,
	args: CheckpointUlwLoopArgs & { readonly advance: boolean },
	scope?: UlwLoopScope,
): Promise<CheckpointAndContinueResult> {
	const result = await checkpointUlwLoop(repoRoot, args, scope);
	if (args.status !== "complete" || result.aggregateCompletion !== undefined || !args.advance) return result;
	const next = await startNextUlwLoop(repoRoot, {}, scope);
	if ("done" in next) return { ...result, plan: next.plan, next: doneNext(next.plan) };
	const instruction = buildCodexGoalInstruction({ plan: next.plan, goal: next.goal });
	return { ...result, plan: next.plan, next: { resumed: next.resumed, goal: next.goal, instruction } };
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
	const args: CheckpointUlwLoopArgs & { readonly advance: boolean } = {
		goalId,
		status: statusValue,
		evidence,
		advance: !hasFlag(argv, "--no-advance"),
		...(codexGoalJson === undefined ? {} : { codexGoalJson }),
		...(qualityGateJson === undefined ? {} : { qualityGateJson }),
	};
	const result = await checkpointAndContinue(repoRoot, args, scope);
	if (json) printJson({ ok: true, ...result, summary: summarizeUlwLoopPlan(result.plan) });
	else printCheckpointText(result);
	return 0;
}

function printCheckpointText(result: CheckpointAndContinueResult): void {
	process.stdout.write(`ulw-loop checkpoint: ${result.goal.id} -> ${result.goal.status}\n`);
	if (result.next === undefined) return;
	if ("instruction" in result.next) process.stdout.write(`${result.next.instruction.text}\n`);
	else process.stdout.write(`${result.next.handoff || "ulw-loop: all goals complete"}\n`);
}

function doneNext(plan: UlwLoopPlan): ContinuationNext {
	const handoff = blockedDecisionHandoff(plan);
	return { done: true, blocked: handoff.length > 0, handoff };
}

function required(argv: readonly string[], flag: string): string {
	const value = readValue(argv, flag)?.trim();
	if (value) return value;
	throw new UlwLoopError(`Missing ${flag}.`, "ULW_LOOP_ARGUMENT_MISSING", { details: { flag } });
}

function checkpointStatus(value: string): CheckpointUlwLoopArgs["status"] {
	if (value === "complete" || value === "failed" || value === "blocked") return value;
	throw new UlwLoopError(
		"Missing or invalid --status; expected complete, failed, or blocked.",
		"ULW_LOOP_STATUS_INVALID",
		{ details: { status: value } },
	);
}

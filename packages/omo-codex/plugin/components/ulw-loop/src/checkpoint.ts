// biome-ignore-all format: checkpoint stays under the pure LOC ceiling.
import { existsSync, statSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
	combineCheckpointValidationErrors,
	validateCheckpointCodexGoal,
} from "./checkpoint-codex-validation.js";
import { requireAllCriteriaPass, requireAllPlanCriteriaPass, requireEssentialCriteriaPass } from "./evidence.js";
import { codexGoalMode, isFinalRunCompletionCandidate } from "./goal-status.js";
import type { UlwLoopScope } from "./paths.js";
import { ulwLoopAttemptEvidenceDir } from "./paths.js";
import { appendLedger, readUlwLoopPlan, withUlwLoopMutationLock, writePlan } from "./plan-io.js";
import {
	classifyExternalAuthorizationBlocker,
	clearGoalBlockerFields,
	sameBlockerOccurrences,
	validateQualityGate,
} from "./quality-gate.js";
import { resolveToolkitSurface } from "./surface.js";
import type {
	UlwLoopAggregateCompletion,
	UlwLoopItem,
	UlwLoopLedgerEntry,
	UlwLoopPlan,
	UlwLoopQualityGate,
} from "./types.js";
import { iso, UlwLoopError } from "./types.js";
import { batchClosedBy, requireAllValidationBatchesClosed, requireBatchFinalReady, requireBatchGate } from "./validation-batch.js";

export interface CheckpointUlwLoopArgs {
	readonly goalId: string;
	readonly status: "complete" | "failed" | "blocked";
	readonly evidence: string;
	readonly codexGoalJson?: string;
	readonly qualityGateJson?: string;
}
export interface CheckpointUlwLoopResult {
	readonly plan: UlwLoopPlan;
	readonly goal: UlwLoopItem;
	readonly ledgerEntry: UlwLoopLedgerEntry;
	readonly aggregateCompletion?: UlwLoopAggregateCompletion;
}

const QUALITY_GATE_FS = { existsSync, statSync } as const;

function ulwLoopFail(message: string, code: string): never {
	throw new UlwLoopError(message, code);
}
function nonEmptyEvidence(value: string): string {
	const trimmed = value.trim();
	return trimmed || ulwLoopFail("Evidence must be a non-empty string.", "ulw_loop_evidence_required");
}
function findGoal(plan: UlwLoopPlan, goalId: string): UlwLoopItem {
	const goal = plan.goals.find((candidate) => candidate.id === goalId);
	return goal ?? ulwLoopFail(`Unknown ulw-loop id: ${goalId}.`, "ulw_loop_goal_not_found");
}

async function readJsonInput(raw: string | undefined, repoRoot: string): Promise<unknown> {
	if (raw === undefined || raw.trim() === "") return undefined;
	const trimmed = raw.trim();
	try {
		return JSON.parse(trimmed);
	} catch (error) {
		if (!(error instanceof SyntaxError)) throw error;
	}
	const path = resolve(repoRoot, trimmed);
	if (!existsSync(path))
		return ulwLoopFail("Quality gate JSON is neither valid JSON nor a readable path.", "ulw_loop_json_input_invalid");
	try {
		return JSON.parse(await readFile(path, "utf8"));
	} catch (error) {
		return ulwLoopFail(
			`Quality gate path does not contain valid JSON${error instanceof Error ? `: ${error.message}` : "."}`,
			"ulw_loop_json_input_invalid",
		);
	}
}

function makeAggregateCompletion(now: string, evidence: string, codexGoal: unknown): UlwLoopAggregateCompletion {
	return { status: "complete", completedAt: now, evidence, codexGoal };
}

function applyBlockedOrFailed(
	goal: UlwLoopItem,
	plan: UlwLoopPlan,
	status: "failed" | "blocked",
	evidence: string,
	now: string,
): void {
	const signature = classifyExternalAuthorizationBlocker(evidence);
	const occurrences = signature === null ? 0 : sameBlockerOccurrences(plan, signature) + 1;
	const needsDecision = signature !== null && occurrences >= 3;
	goal.status = needsDecision ? "needs_user_decision" : status;
	goal.updatedAt = now;
	if (status === "failed" || needsDecision) {
		goal.failedAt = now;
		goal.failureReason = evidence;
	}
	if (status === "blocked" || needsDecision) goal.blockedReason = evidence;
	if (signature !== null) {
		goal.blockerSignature = signature;
		goal.blockerOccurrenceCount = occurrences;
		goal.requiredExternalDecision = `Resolve external authorization: ${signature}`;
	}
	if (needsDecision) goal.nonRetriable = true;
	if (plan.activeGoalId === goal.id) delete plan.activeGoalId;
}

function ledgerKind(
	status: CheckpointUlwLoopArgs["status"],
	goal: UlwLoopItem,
	aggregateCompletion: UlwLoopAggregateCompletion | undefined,
): UlwLoopLedgerEntry["kind"] {
	if (aggregateCompletion !== undefined) return "aggregate_completed";
	if (status === "complete") return "goal_completed";
	if (goal.status === "needs_user_decision") return "goal_needs_user_decision";
	return status === "blocked" ? "goal_blocked" : "goal_failed";
}

function buildLedger(
	now: string,
	args: CheckpointUlwLoopArgs,
	goal: UlwLoopItem,
	qualityGate: UlwLoopQualityGate | undefined,
	codexGoal: unknown,
	aggregateCompletion: UlwLoopAggregateCompletion | undefined,
): UlwLoopLedgerEntry {
	const watch = qualityGate?.surface === "lazycodex" && qualityGate.codeReview.codeQualityStatus === "WATCH";
	const entry: UlwLoopLedgerEntry = {
		at: now,
		kind: ledgerKind(args.status, goal, aggregateCompletion),
		goalId: goal.id,
		status: goal.status,
		evidence:
			watch && qualityGate.surface === "lazycodex"
				? `${args.evidence} | codeQuality=WATCH: ${qualityGate.codeReview.evidence}`
				: args.evidence,
	};
	if (codexGoal !== undefined) entry.codexGoal = codexGoal;
	if (qualityGate !== undefined) entry.qualityGate = qualityGate;
	if (goal.blockerSignature !== undefined) entry.blockerSignature = goal.blockerSignature;
	if (goal.blockerOccurrenceCount !== undefined) entry.blockerOccurrenceCount = goal.blockerOccurrenceCount;
	if (goal.requiredExternalDecision !== undefined) entry.requiredExternalDecision = goal.requiredExternalDecision;
	return entry;
}

export async function checkpointUlwLoop(
	repoRoot: string,
	args: CheckpointUlwLoopArgs,
	scope?: UlwLoopScope,
): Promise<CheckpointUlwLoopResult> {
	return withUlwLoopMutationLock(repoRoot, scope, async () => {
		const plan = await readUlwLoopPlan(repoRoot, scope);
		const goal = findGoal(plan, args.goalId);
		const evidence = nonEmptyEvidence(args.evidence);
		const now = iso();
		let aggregateCompletion: UlwLoopAggregateCompletion | undefined;
		let qualityGate: UlwLoopQualityGate | undefined;
		let codexGoal: unknown;
		if (args.status === "complete") {
			const aggregate = codexGoalMode(plan) === "aggregate";
			const final = isFinalRunCompletionCandidate(plan, goal);
			const closesBatch = batchClosedBy(plan, goal.id) !== undefined;
			if (final) {
				requireAllCriteriaPass(goal);
				requireAllPlanCriteriaPass(plan);
				requireAllValidationBatchesClosed(plan, goal.id);
			} else if (aggregate) requireEssentialCriteriaPass(goal);
			else requireAllCriteriaPass(goal);
			let codexValidationError: UlwLoopError | undefined;
			try {
				codexGoal = await validateCheckpointCodexGoal({
					repoRoot,
					plan,
					goal,
					raw: args.codexGoalJson,
					evidence,
					...(scope === undefined ? {} : { scope }),
				});
			} catch (error) {
				if (!(error instanceof UlwLoopError)) throw error;
				codexValidationError = error;
			}
			if (closesBatch) requireBatchFinalReady(plan, goal);
			if (closesBatch && args.qualityGateJson === undefined)
				throw new UlwLoopError("Validation batch final checkpoint requires --quality-gate-json.", "ULW_LOOP_VALIDATION_BATCH_GATE_REQUIRED");
			if (final) aggregateCompletion = makeAggregateCompletion(now, evidence, codexGoal);
			if (final || aggregateCompletion !== undefined || closesBatch) {
				try {
					qualityGate = validateQualityGate(await readJsonInput(args.qualityGateJson, repoRoot), {
						repoRoot,
						fs: QUALITY_GATE_FS,
						reviewerSurface: resolveToolkitSurface(),
						...(plan.evidenceLayoutVersion === 2
							? { currentAttemptDir: ulwLoopAttemptEvidenceDir(goal.id, goal.attempt, scope) }
							: {}),
					});
					requireBatchGate(plan, goal, qualityGate);
				} catch (error) {
					if (!(error instanceof UlwLoopError) || codexValidationError === undefined) throw error;
					throw combineCheckpointValidationErrors(codexValidationError, error);
				}
			}
			if (codexValidationError !== undefined) throw codexValidationError;
			goal.status = "complete";
			goal.completedAt = now;
			goal.evidence = evidence;
			delete goal.failedAt;
			delete goal.failureReason;
			clearGoalBlockerFields(goal);
			if (plan.activeGoalId === goal.id) delete plan.activeGoalId;
		} else applyBlockedOrFailed(goal, plan, args.status, evidence, now);
		goal.updatedAt = now;
		if (aggregateCompletion !== undefined) plan.aggregateCompletion = aggregateCompletion;
		plan.updatedAt = now;
		await writePlan(repoRoot, plan, scope);
		const ledgerEntry = buildLedger(now, args, goal, qualityGate, codexGoal, aggregateCompletion);
		await appendLedger(repoRoot, ledgerEntry, scope);
		const closedBatch = args.status === "complete" ? batchClosedBy(plan, goal.id) : undefined;
		if (closedBatch !== undefined) await appendLedger(repoRoot, { at: now, kind: "batch_closed", goalId: goal.id, message: closedBatch.batchId }, scope);
		return aggregateCompletion === undefined
			? { plan, goal, ledgerEntry }
			: { plan, goal, ledgerEntry, aggregateCompletion };
	});
}

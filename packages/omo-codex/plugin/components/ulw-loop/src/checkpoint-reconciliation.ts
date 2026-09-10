import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { CodexGoalReconciliation, CodexGoalSnapshot } from "./codex-goal-snapshot.js";
import { codexGoalMismatchRecovery, formatCodexGoalReconciliation } from "./codex-goal-snapshot.js";
import { codexGoalMode, isFinalRunCompletionCandidate } from "./goal-status.js";
import { type UlwLoopScope, ulwLoopBriefPath } from "./paths.js";
import type { UlwLoopItem, UlwLoopPlan } from "./types.js";
import { ULW_LOOP_DIR, ULW_LOOP_GOALS, ULW_LOOP_LEDGER, UlwLoopError } from "./types.js";

export interface CodexSnapshotMismatchInput {
	readonly reconciliation: CodexGoalReconciliation;
	readonly snapshot: CodexGoalSnapshot | null | undefined;
	readonly expectedObjective: string;
	/** Only the checkpoint path can fall back to task-scoped aggregate reconciliation, so only it asks for that hint. */
	readonly taskScopedHint?: { readonly goal: UlwLoopItem; readonly aggregate: boolean; readonly final: boolean };
}

export function combineCheckpointValidationErrors(codexError: UlwLoopError, gateError: UlwLoopError): UlwLoopError {
	return new UlwLoopError(`${codexError.message}\n${gateError.message}`, "ULW_LOOP_QUALITY_GATE_INVALID", {
		details: { ...(codexError.details ?? {}), ...(gateError.details ?? {}) },
	});
}

export function codexSnapshotMismatchError(input: CodexSnapshotMismatchInput): UlwLoopError {
	const { reconciliation, snapshot, taskScopedHint } = input;
	const hint =
		taskScopedHint?.aggregate === true && snapshot?.status === "complete" && snapshot.objective !== undefined
			? buildTaskScopedAggregateReconciliationHint(taskScopedHint.goal, taskScopedHint.final)
			: "";
	const recovery = codexGoalMismatchRecovery(input.expectedObjective, snapshot);
	return new UlwLoopError(
		`${formatCodexGoalReconciliation(reconciliation)}${hint}\n${recovery.message}`,
		"ulw_loop_codex_snapshot_mismatch",
		{ details: recovery.details },
	);
}

function normalizeObjective(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

function textMentionsUlwLoopPlanArtifact(value: string | undefined): boolean {
	const normalized = (value ?? "").toLowerCase();
	return (
		normalized.includes(ULW_LOOP_DIR.toLowerCase()) ||
		normalized.includes(ULW_LOOP_GOALS.toLowerCase()) ||
		normalized.includes(ULW_LOOP_LEDGER.toLowerCase())
	);
}

function textMentionsGoalId(value: string | undefined, goalId: string): boolean {
	return (value ?? "").toLowerCase().includes(goalId.toLowerCase());
}

function textHasCompletionValidationEvidence(value: string | undefined): boolean {
	const normalized = (value ?? "").toLowerCase();
	const done =
		/\b(?:planned work|implementation|deliverables?|scope|task|work)\b/.test(normalized) &&
		/\b(?:done|complete|completed|finished|shipped)\b/.test(normalized);
	const verified =
		/\b(?:validation|verification|tests?|build|lint|review|quality gate|code-review)\b/.test(normalized) &&
		/\b(?:passed|complete|completed|clean|green|approve|approved|clear)\b/.test(normalized);
	return done && verified;
}

async function snapshotObjectiveMapsToUlwLoopPlan(
	repoRoot: string,
	snapshotObjective: string,
	scope?: UlwLoopScope,
): Promise<boolean> {
	const actual = normalizeObjective(snapshotObjective).toLowerCase();
	if (textMentionsUlwLoopPlanArtifact(actual)) return true;
	if (actual.length < 24 || !existsSync(ulwLoopBriefPath(repoRoot, scope))) return false;
	try {
		const brief = normalizeObjective(await readFile(ulwLoopBriefPath(repoRoot, scope), "utf8")).toLowerCase();
		return brief.length >= 24 && (brief.includes(actual) || actual.includes(brief));
	} catch (error) {
		if (error instanceof Error) return false;
		throw error;
	}
}

export async function canReconcileCompletedTaskScopedAggregateSnapshot(
	repoRoot: string,
	plan: UlwLoopPlan,
	goal: UlwLoopItem,
	snapshotObjective: string,
	evidence: string,
	scope?: UlwLoopScope,
): Promise<boolean> {
	if (codexGoalMode(plan) !== "aggregate") return false;
	if (goal.status !== "in_progress" || plan.activeGoalId !== goal.id) return false;
	if (isFinalRunCompletionCandidate(plan, goal)) {
		return snapshotObjectiveMapsToUlwLoopPlan(repoRoot, snapshotObjective, scope);
	}
	if (!textMentionsUlwLoopPlanArtifact(evidence) || !textMentionsGoalId(evidence, goal.id)) return false;
	if (!textHasCompletionValidationEvidence(evidence)) return false;
	return snapshotObjectiveMapsToUlwLoopPlan(repoRoot, snapshotObjective, scope);
}

export async function canReconcileActiveFinalTaskScopedAggregateSnapshot(
	repoRoot: string,
	plan: UlwLoopPlan,
	goal: UlwLoopItem,
	snapshotObjective: string,
	evidence: string,
	scope?: UlwLoopScope,
): Promise<boolean> {
	if (codexGoalMode(plan) !== "aggregate") return false;
	if (goal.status !== "in_progress" || plan.activeGoalId !== goal.id) return false;
	if (!isFinalRunCompletionCandidate(plan, goal)) return false;
	if (!textHasCompletionValidationEvidence(evidence)) return false;
	return snapshotObjectiveMapsToUlwLoopPlan(repoRoot, snapshotObjective, scope);
}

function buildCompletedLegacyGoalRemediation(goal: UlwLoopItem): string {
	return [
		"If get_goal returns a different completed legacy/thread objective, do not repeat --status complete in this thread.",
		`Record a non-terminal blocker with: omo-agent-toolkit ulw-loop checkpoint --goal-id ${goal.id} --status blocked --evidence "<completed legacy Codex goal blocks create_goal in this thread>" --codex-goal-json "<different completed get_goal JSON or path>".`,
		"Then continue only from a Codex goal context with no active/completed conflicting goal, in the same repo/worktree, and create the intended goal there.",
	].join(" ");
}

export function buildTaskScopedAggregateReconciliationHint(goal: UlwLoopItem, final: boolean): string {
	if (final) {
		return ` Final task-scoped aggregate reconciliation requires the checkpoint goal to be the active in-progress final OMO goal and the completed get_goal objective to map to the ulw-loop brief or artifact. ${buildCompletedLegacyGoalRemediation(goal)}`;
	}
	return ` Completed task-scoped aggregate reconciliation requires the checkpoint goal to be the active in-progress OMO goal, evidence that names that active OMO goal id, names .omo/ulw-loop/goals.json or ledger.jsonl, includes completed implementation plus validation/review evidence, and a get_goal objective that maps to the ulw-loop brief/artifact. ${buildCompletedLegacyGoalRemediation(goal)}`;
}

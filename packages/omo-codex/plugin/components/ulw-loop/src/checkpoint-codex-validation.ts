import {
	canReconcileActiveFinalTaskScopedAggregateSnapshot,
	canReconcileCompletedTaskScopedAggregateSnapshot,
	codexSnapshotMismatchError,
} from "./checkpoint-reconciliation.js";
import { readCodexGoalSnapshotInput, reconcileCodexGoalSnapshot } from "./codex-goal-snapshot.js";
import {
	codexGoalMode,
	compatibleCodexObjectives,
	expectedCodexObjective,
	isFinalRunCompletionCandidate,
} from "./goal-status.js";
import type { UlwLoopScope } from "./paths.js";
import type { UlwLoopItem, UlwLoopPlan } from "./types.js";
import { UlwLoopError } from "./types.js";

function normalizeObjective(value: string): string {
	return value.replace(/\s+/g, " ").trim();
}

export async function validateCheckpointCodexGoal(input: {
	readonly repoRoot: string;
	readonly plan: UlwLoopPlan;
	readonly goal: UlwLoopItem;
	readonly raw: string | undefined;
	readonly evidence: string;
	readonly scope?: UlwLoopScope;
}): Promise<unknown> {
	const aggregate = codexGoalMode(input.plan) === "aggregate";
	const final = isFinalRunCompletionCandidate(input.plan, input.goal);
	const snapshot = await readCodexGoalSnapshotInput(input.raw, input.repoRoot);
	const expectedObjective = expectedCodexObjective(input.plan, input.goal);
	const reconciliation = reconcileCodexGoalSnapshot(snapshot, {
		expectedObjective,
		...(aggregate ? { acceptedObjectives: compatibleCodexObjectives(input.plan) } : {}),
		allowedStatuses: aggregate ? (final ? ["complete"] : ["active"]) : ["complete"],
		requireSnapshot: true,
		requireComplete: !aggregate || final,
	});
	if (reconciliation.ok) return reconciliation.snapshot.raw;
	const objective = snapshot?.objective;
	const mismatchedTaskObjective =
		snapshot?.available === true &&
		objective !== undefined &&
		normalizeObjective(objective) !== normalizeObjective(expectedObjective);
	const completedTaskScoped =
		mismatchedTaskObjective &&
		snapshot.status === "complete" &&
		(await canReconcileCompletedTaskScopedAggregateSnapshot(
			input.repoRoot,
			input.plan,
			input.goal,
			objective,
			input.evidence,
			input.scope,
		));
	const activeFinalTaskScoped =
		mismatchedTaskObjective &&
		snapshot.status === "active" &&
		(await canReconcileActiveFinalTaskScopedAggregateSnapshot(
			input.repoRoot,
			input.plan,
			input.goal,
			objective,
			input.evidence,
			input.scope,
		));
	if (completedTaskScoped || activeFinalTaskScoped) return reconciliation.snapshot.raw;
	throw codexSnapshotMismatchError({
		reconciliation,
		snapshot,
		expectedObjective,
		taskScopedHint: { goal: input.goal, aggregate, final },
	});
}

export function combineCheckpointValidationErrors(codexError: UlwLoopError, gateError: UlwLoopError): UlwLoopError {
	return new UlwLoopError(`${codexError.message}\n${gateError.message}`, "ULW_LOOP_QUALITY_GATE_INVALID", {
		details: { ...(codexError.details ?? {}), ...(gateError.details ?? {}) },
	});
}

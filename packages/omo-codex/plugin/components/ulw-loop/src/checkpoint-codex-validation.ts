import {
	CodexGoalSnapshotError,
	formatCodexGoalReconciliation,
	readCodexGoalSnapshotInput,
	reconcileCodexGoalSnapshot,
} from "./codex-goal-snapshot.js";
import { acknowledgedDriverObjectives } from "./driver-objective-ack.js";
import { codexGoalMode, compatibleCodexObjectives, expectedCodexObjective } from "./goal-status.js";
import type { UlwLoopScope } from "./paths.js";
import type { UlwLoopItem, UlwLoopPlan } from "./types.js";
import { UlwLoopError } from "./types.js";

export interface CheckpointCodexGoalValidation {
	readonly raw: unknown;
	readonly nextActions: readonly string[];
	readonly warnings: readonly string[];
	readonly unacknowledgedObjective?: string;
}

export async function validateCheckpointCodexGoal(input: {
	readonly repoRoot: string;
	readonly plan: UlwLoopPlan;
	readonly goal: UlwLoopItem;
	readonly raw: string | undefined;
	readonly evidence: string;
	readonly scope?: UlwLoopScope;
}): Promise<CheckpointCodexGoalValidation> {
	const snapshot = await readCodexGoalSnapshotInput(input.raw, input.repoRoot);
	const expected = expectedCodexObjective(input.plan, input.goal);
	const reconciliation = reconcileCodexGoalSnapshot(snapshot, {
		expectedObjective: expected,
		acknowledgedObjectives: acknowledgedDriverObjectives(input.plan),
		...(codexGoalMode(input.plan) === "aggregate"
			? { acceptedObjectives: compatibleCodexObjectives(input.plan) }
			: {}),
	});
	if (!reconciliation.ok) throw new CodexGoalSnapshotError(formatCodexGoalReconciliation(reconciliation));
	return {
		raw: snapshot?.raw,
		nextActions: reconciliation.nextActions,
		warnings: reconciliation.warnings,
		...(reconciliation.unacknowledgedObjective === undefined
			? {}
			: { unacknowledgedObjective: reconciliation.unacknowledgedObjective }),
	};
}

export function combineCheckpointValidationErrors(codexError: UlwLoopError, gateError: UlwLoopError): UlwLoopError {
	return new UlwLoopError(`${codexError.message}\n${gateError.message}`, "ULW_LOOP_QUALITY_GATE_INVALID", {
		details: { ...(codexError.details ?? {}), ...(gateError.details ?? {}) },
	});
}

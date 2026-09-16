import {
	CodexGoalSnapshotError,
	formatCodexGoalReconciliation,
	readCodexGoalSnapshotInput,
	reconcileCodexGoalSnapshot,
} from "./codex-goal-snapshot.js";
import { codexGoalMode, compatibleCodexObjectives, expectedCodexObjective } from "./goal-status.js";
import type { UlwLoopScope } from "./paths.js";
import type { UlwLoopItem, UlwLoopPlan } from "./types.js";
import { UlwLoopError } from "./types.js";

export async function validateCheckpointCodexGoal(input: {
	readonly repoRoot: string;
	readonly plan: UlwLoopPlan;
	readonly goal: UlwLoopItem;
	readonly raw: string | undefined;
	readonly evidence: string;
	readonly scope?: UlwLoopScope;
}): Promise<{ readonly raw: unknown; readonly nextActions: readonly string[]; readonly warnings: readonly string[] }> {
	const snapshot = await readCodexGoalSnapshotInput(input.raw, input.repoRoot);
	const expected = expectedCodexObjective(input.plan, input.goal);
	const reconciliation = reconcileCodexGoalSnapshot(snapshot, {
		expectedObjective: expected,
		...(codexGoalMode(input.plan) === "aggregate"
			? { acceptedObjectives: compatibleCodexObjectives(input.plan) }
			: {}),
	});
	if (!reconciliation.ok) throw new CodexGoalSnapshotError(formatCodexGoalReconciliation(reconciliation));
	// Only actionable advice goes into nextActions; informational differences go into warnings only.
	// When the driver goal exists but its objective differs, the SDK should not tell the agent to
	// create_goal (the goal already exists) or repeat the diff on every call — that belongs in warnings.
	const nextActions = reconciliation.warnings.filter(
		(warning) => !warning.startsWith("driver_objective_differs:"),
	);
	const warnings = reconciliation.warnings.filter((warning) => warning.startsWith("driver_objective_differs"));
	return { raw: snapshot?.raw, nextActions, warnings };
}

export function combineCheckpointValidationErrors(codexError: UlwLoopError, gateError: UlwLoopError): UlwLoopError {
	return new UlwLoopError(`${codexError.message}\n${gateError.message}`, "ULW_LOOP_QUALITY_GATE_INVALID", {
		details: { ...(codexError.details ?? {}), ...(gateError.details ?? {}) },
	});
}

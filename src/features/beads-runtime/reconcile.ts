import {
	applyBeadsRuntimeToBoulderState,
	markBoulderRuntimeStateStale,
	readBoulderState,
	writeBoulderState,
} from "../boulder-state";
import {
	readBeadsRuntimeInProgress,
	readBeadsRuntimeIssueDetails,
	readBeadsRuntimeReady,
} from "./br-cli";
import { resolveBeadsRuntimeCommandCwd } from "./br-command-cwd";
import type { BeadsRuntimeCommandRunner } from "./br-command-runner";
import { createBeadsRuntimeAttachError } from "./errors";
import {
	type BeadsRuntimeReconcileState,
	createDetachedBeadsReconcileState,
	createFailedBeadsReconcileState,
	createPendingBeadsReconcileState,
	createReconciledBeadsReconcileState,
	createStaleBeadsReconcileState,
} from "./reconcile-state";

export interface BeadsRuntimeReconcileResult {
	beadID?: string;
	cwd: string;
	state: BeadsRuntimeReconcileState;
	lastReconciledAt?: string;
}

function persistRuntimeConflictState(args: {
	directory: string;
	state: NonNullable<ReturnType<typeof readBoulderState>>;
	durableBeadID: string;
	reason: string;
	checkedAt: string;
}): void {
	writeBoulderState(args.directory, {
		...args.state,
		bead_id: args.durableBeadID,
		bead_runtime_state: markBoulderRuntimeStateStale({
			current: args.state.bead_runtime_state,
			reason: args.reason,
			checkedAt: args.checkedAt,
		}),
	});
}

function getRecordedBeadID(directory: string): string | undefined {
	const beadID = readBoulderState(directory)?.bead_id?.trim();
	return beadID ? beadID : undefined;
}

export async function reconcileBeadsRuntimeState(args: {
	directory: string;
	beadID?: string;
	worktreePath?: string;
	runner?: BeadsRuntimeCommandRunner;
	requireDetails?: boolean;
}): Promise<BeadsRuntimeReconcileResult> {
	const currentState = readBoulderState(args.directory);
	const currentDurableBeadID = currentState?.bead_id?.trim();
	const recordedBeadID = args.beadID?.trim() || currentState?.bead_id?.trim();
	const cwd = resolveBeadsRuntimeCommandCwd({
		directory: args.directory,
		state: currentState,
		worktreePath: args.worktreePath,
	});

	if (!recordedBeadID) {
		return {
			cwd,
			state: createDetachedBeadsReconcileState(),
		};
	}

	const inProgress = await readBeadsRuntimeInProgress({
		cwd,
		runner: args.runner,
	});
	const refreshedBeadID = getRecordedBeadID(args.directory);
	if (
		args.beadID?.trim() &&
		refreshedBeadID &&
		args.beadID.trim() !== refreshedBeadID &&
		currentDurableBeadID === refreshedBeadID
	) {
		const checkedAt = new Date().toISOString();
		const reason = `runtime bead hint ${args.beadID.trim()} diverged from durable truth ${refreshedBeadID}; durable truth wins`;
		const refreshedState = readBoulderState(args.directory);
		if (refreshedState?.bead_id?.trim() === refreshedBeadID) {
			persistRuntimeConflictState({
				directory: args.directory,
				state: refreshedState,
				durableBeadID: refreshedBeadID,
				reason,
				checkedAt,
			});
		}

		return {
			beadID: refreshedBeadID,
			cwd,
			state: createStaleBeadsReconcileState(reason, checkedAt),
		};
	}

	if (refreshedBeadID && refreshedBeadID !== recordedBeadID) {
		throw createBeadsRuntimeAttachError({
			message:
				"beads runtime reconciliation refused to trust stale in-memory bead metadata after the ledger was re-read",
			details: {
				directory: args.directory,
				expectedBeadID: recordedBeadID,
				actualBeadID: refreshedBeadID,
				cwd,
			},
		});
	}

	const checkedAt = new Date().toISOString();
	const inProgressIssue = inProgress.issues.find(
		(issue) => issue.id === recordedBeadID,
	);
	if (!inProgressIssue) {
		return {
			beadID: recordedBeadID,
			cwd,
			state: createStaleBeadsReconcileState(
				`bead ${recordedBeadID} is no longer present in br list --status in_progress --json`,
				checkedAt,
			),
		};
	}

	if (args.requireDetails) {
		const details = await readBeadsRuntimeIssueDetails({
			beadID: recordedBeadID,
			cwd,
			runner: args.runner,
		});
		if (!details.some((issue) => issue.id === recordedBeadID)) {
			return {
				beadID: recordedBeadID,
				cwd,
				state: createFailedBeadsReconcileState(
					`beads runtime expected br show ${recordedBeadID} --json to include the requested bead`,
					checkedAt,
				),
			};
		}
	}

	const ready = await readBeadsRuntimeReady({ cwd, runner: args.runner });
	const lastReconciledAt = checkedAt;
	const nextState = ready.some((issue) => issue.id === recordedBeadID)
		? createPendingBeadsReconcileState(checkedAt)
		: createReconciledBeadsReconcileState(checkedAt);

	const stateAfterRead = readBoulderState(args.directory);
	if (stateAfterRead?.bead_id?.trim() === recordedBeadID) {
		writeBoulderState(
			args.directory,
			applyBeadsRuntimeToBoulderState(stateAfterRead, {
				beadID: recordedBeadID,
				worktreePath: cwd,
				lastReconciledAt,
			}),
		);
	}

	return {
		beadID: recordedBeadID,
		cwd,
		state: nextState,
		lastReconciledAt,
	};
}

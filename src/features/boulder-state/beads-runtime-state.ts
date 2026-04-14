import type { BeadsRuntimeTaskMetadata } from "../beads-runtime";
import { createBoulderRuntimeStateMetadata } from "./runtime-provenance";
import type { BoulderState } from "./types";

export function applyBeadsRuntimeToBoulderState(
	state: BoulderState,
	beadsRuntime?: BeadsRuntimeTaskMetadata,
): BoulderState {
	if (!beadsRuntime?.beadID) {
		return state;
	}

	const beadWorktreePath = beadsRuntime.worktreePath ?? state.worktree_path;

	return {
		...state,
		bead_id: beadsRuntime.beadID,
		...(beadsRuntime.sourceCommand !== undefined
			? { bead_source_command: beadsRuntime.sourceCommand }
			: {}),
		...(beadWorktreePath !== undefined
			? { bead_worktree_path: beadWorktreePath }
			: {}),
		...(beadsRuntime.lastReconciledAt !== undefined
			? { bead_last_reconciled_at: beadsRuntime.lastReconciledAt }
			: {}),
		bead_runtime_state: createBoulderRuntimeStateMetadata(
			beadsRuntime,
			state.bead_runtime_state,
		),
	};
}

export function getBoulderBeadsRuntimeMetadata(
	state: BoulderState | null | undefined,
): BeadsRuntimeTaskMetadata | undefined {
	if (!state) {
		return undefined;
	}

	const beadID = state?.bead_id?.trim();
	if (!beadID) {
		return undefined;
	}

	const worktreePath = state.bead_worktree_path ?? state.worktree_path;

	return {
		beadID,
		...(state.bead_source_command !== undefined
			? { sourceCommand: state.bead_source_command }
			: {}),
		...(worktreePath !== undefined ? { worktreePath } : {}),
		...(state.bead_last_reconciled_at !== undefined
			? { lastReconciledAt: state.bead_last_reconciled_at }
			: {}),
	};
}

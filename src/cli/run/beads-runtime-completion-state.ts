import {
	type BeadsRuntimeReconcileResult,
	pruneInactiveBeadsRuntimeAttachments,
	reconcileBeadsRuntimeState,
} from "../../features/beads-runtime";
import { readBoulderState } from "../../features/boulder-state";

import { logCompletionWait } from "./completion-wait-log";
import type { RunContext } from "./types";

export interface BeadsCompletionDeps {
	readBoulderState: typeof readBoulderState;
	pruneInactiveBeadsRuntimeAttachments: typeof pruneInactiveBeadsRuntimeAttachments;
	reconcileBeadsRuntimeState: typeof reconcileBeadsRuntimeState;
}

const DEFAULT_BEADS_COMPLETION_DEPS: BeadsCompletionDeps = {
	readBoulderState,
	pruneInactiveBeadsRuntimeAttachments,
	reconcileBeadsRuntimeState,
};

export async function ensureBeadsCompletionReady(
	ctx: RunContext,
	deps: BeadsCompletionDeps = DEFAULT_BEADS_COMPLETION_DEPS,
): Promise<boolean> {
	const beadsCompletionState = await resolveBeadsCompletionState(ctx, deps);
	if (beadsCompletionState.ready) {
		return true;
	}

	logCompletionWait(
		ctx,
		beadsCompletionState.reason ?? "bead reconciliation is not yet complete",
	);
	return false;
}

async function resolveBeadsCompletionState(
	ctx: RunContext,
	deps: BeadsCompletionDeps,
): Promise<{ ready: boolean; reason?: string }> {
	const boulderState = deps.readBoulderState(ctx.directory);
	const beadID = boulderState?.bead_id?.trim();
	if (
		!boulderState ||
		!beadID ||
		!boulderState.session_ids.includes(ctx.sessionID)
	) {
		return { ready: true };
	}

	const attachConflictReason = getBeadsAttachConflictReason(
		ctx,
		beadID,
		boulderState.active_plan,
		boulderState.started_at,
		boulderState.bead_worktree_path ?? boulderState.worktree_path,
		deps,
	);
	if (attachConflictReason) {
		return { ready: false, reason: attachConflictReason };
	}

	try {
		const reconcileResult = await deps.reconcileBeadsRuntimeState({
			directory: ctx.directory,
			beadID,
			worktreePath:
				boulderState.bead_worktree_path ?? boulderState.worktree_path,
		});
		return getBeadsReconcileCompletionState(reconcileResult);
	} catch (error) {
		const message = error instanceof Error ? error.message : String(error);
		return {
			ready: false,
			reason: `bead reconciliation failed for ${beadID}: ${message}`,
		};
	}
}

function getBeadsAttachConflictReason(
	ctx: RunContext,
	beadID: string,
	activePlan: string,
	startedAt: string,
	worktreePath: string | undefined,
	deps: BeadsCompletionDeps,
): string | null {
	const registry = deps.pruneInactiveBeadsRuntimeAttachments(
		worktreePath ?? ctx.directory,
	);
	const attachment = registry[beadID];
	if (!attachment) {
		return null;
	}

	const continuationKey = `${activePlan}::${startedAt}`;
	if (attachment.continuationKey === continuationKey) {
		return null;
	}

	return `bead attach conflict: bead ${beadID} is attached to another active continuation`;
}

function getBeadsReconcileCompletionState(
	result: BeadsRuntimeReconcileResult,
): {
	ready: boolean;
	reason?: string;
} {
	const beadID = result.beadID ?? "unknown bead";
	if (result.state.status === "reconciled") {
		return { ready: true };
	}

	if (result.state.status === "pending") {
		return {
			ready: false,
			reason: `bead reconciliation pending for ${beadID}: bead still appears in br ready --json`,
		};
	}

	if (result.state.status === "stale") {
		return {
			ready: false,
			reason: `stale bead state for ${beadID}: ${result.state.reason ?? "bead is missing from the authoritative in-progress list"}`,
		};
	}

	if (result.state.status === "failed") {
		return {
			ready: false,
			reason: `bead reconciliation failed for ${beadID}: ${result.state.reason ?? "beads runtime returned an invalid detail response"}`,
		};
	}

	return {
		ready: false,
		reason: `stale bead state for ${beadID}: runtime attach metadata is no longer available`,
	};
}

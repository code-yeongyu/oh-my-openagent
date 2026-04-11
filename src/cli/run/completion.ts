import pc from "picocolors";
import type { BeadsCompletionDeps } from "./beads-runtime-completion-state";
import { ensureBeadsCompletionReady } from "./beads-runtime-completion-state";
import { areAllChildrenIdle } from "./child-session-idleness";
import { logCompletionWait } from "./completion-wait-log";
import { areContinuationHooksIdle } from "./continuation-hooks-idleness";
import { getContinuationState } from "./continuation-state";
import { areAllTodosComplete } from "./todo-completion-check";
import type { RunContext } from "./types";

export type { BeadsCompletionDeps } from "./beads-runtime-completion-state";

export async function checkCompletionConditions(
	ctx: RunContext,
	beadsCompletionDeps?: BeadsCompletionDeps,
): Promise<boolean> {
	try {
		const continuationState = await getContinuationState(
			ctx.directory,
			ctx.sessionID,
			ctx.client,
		);

		if (continuationState.hasActiveHookMarker) {
			const reason =
				continuationState.activeHookMarkerReason ??
				"continuation hook is active";
			logCompletionWait(ctx, reason);
			return false;
		}

		if (
			!continuationState.hasTodoHookMarker &&
			!(await areAllTodosComplete(ctx))
		) {
			return false;
		}

		if (!(await areAllChildrenIdle(ctx))) {
			return false;
		}

		if (!areContinuationHooksIdle(ctx, continuationState)) {
			return false;
		}

		if (!(await ensureBeadsCompletionReady(ctx, beadsCompletionDeps))) {
			return false;
		}

		return true;
	} catch (err) {
		console.error(pc.red(`[completion] API error: ${err}`));
		return false;
	}
}

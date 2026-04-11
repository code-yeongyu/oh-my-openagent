import { logCompletionWait } from "./completion-wait-log";
import type { ContinuationState } from "./continuation-state";
import type { RunContext } from "./types";

export function areContinuationHooksIdle(
	ctx: RunContext,
	continuationState: ContinuationState,
): boolean {
	if (continuationState.hasActiveBoulder) {
		logCompletionWait(ctx, "boulder continuation is active");
		return false;
	}

	if (continuationState.hasActiveRalphLoop) {
		logCompletionWait(ctx, "ralph-loop continuation is active");
		return false;
	}

	return true;
}

import type { CreatedHooks } from "../create-hooks";
import { clearBoulderState } from "../features/boulder-state";
import { log } from "../shared";

import { writeBeadCheckpoint } from "./bead-checkpoint";

type StopContinuationHooks = Pick<
	CreatedHooks,
	"stopContinuationGuard" | "todoContinuationEnforcer" | "ralphLoop"
>;

export function finalizeStopContinuation(args: {
	directory: string;
	sessionID: string;
	hooks: StopContinuationHooks;
}): void {
	const { directory, sessionID, hooks } = args;

	hooks.stopContinuationGuard?.stop(sessionID);
	hooks.todoContinuationEnforcer?.cancelAllCountdowns();
	hooks.ralphLoop?.cancelLoop(sessionID);

	writeBeadCheckpoint(directory, sessionID);
	clearBoulderState(directory);
	log(
		"[stop-continuation] All continuation mechanisms stopped after writing checkpoint evidence",
		{
			sessionID,
		},
	);
}

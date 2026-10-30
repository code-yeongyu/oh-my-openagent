/**
 * The user-facing part of an error a person can act on: what happened and what to do.
 *
 * Senpi reads this structurally from a thrown error's own `userFacing` property (senpi#4990) and shows
 * it as a calm notice instead of the raw message and stack, so no senpi import is needed here. The
 * error's `message` stays the full, model-facing text.
 */
export interface UserFacingErrorInfo {
	/** Stable machine code, e.g. `COMPUTER_LAUNCH_CONTEXT_REQUIRED`. */
	readonly code: string;
	/** What happened, in one plain sentence without stack frames or file paths. */
	readonly message: string;
	/** What the user can do next. */
	readonly action: string;
}

/**
 * Safely replace tool arguments without mutating frozen objects.
 *
 * opencode >=1.14 may freeze `output.args` via Immer before plugin hooks run.
 * Direct property assignment (`output.args.key = value`) or `Object.assign(output.args, patch)`
 * throws `TypeError: Attempted to assign to readonly property` on a frozen object.
 *
 * This helper replaces `output.args` with a shallow clone containing the patch,
 * which works regardless of whether the original args object is frozen.
 */
export function replaceToolArgs(
	output: { args: Record<string, unknown> },
	patch: Record<string, unknown>,
): void {
	output.args = { ...output.args, ...patch }
}

/**
 * Patch tool arguments on the object the host will execute.
 *
 * opencode calls `tool.execute.before` with `{ args }` and then runs the tool with its own
 * `args` reference; it never reads `output.args` back. So the patch has to land on that object.
 * Replacing `output.args` with a clone drops the patch silently, and it also detaches the object
 * for every plugin hook that runs afterwards, whose in-place edits are then lost as well.
 *
 * opencode >=1.14 may freeze `output.args` via Immer before plugin hooks run, and assigning to a
 * frozen object throws `TypeError: Attempted to assign to readonly property`. Only in that case
 * does this helper fall back to replacing `output.args` with a shallow clone containing the patch.
 */
export function replaceToolArgs(
	output: { args: Record<string, unknown> },
	patch: Record<string, unknown>,
): void {
	if (Object.isFrozen(output.args)) {
		output.args = { ...output.args, ...patch }
		return
	}
	try {
		Object.assign(output.args, patch)
	} catch {
		output.args = { ...output.args, ...patch }
	}
}

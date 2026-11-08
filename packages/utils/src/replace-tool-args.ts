/**
 * Patch the argument object OpenCode retains for tool execution.
 *
 * opencode >=1.14 may freeze `output.args` via Immer before plugin hooks run.
 * Direct property assignment (`output.args.key = value`) or `Object.assign(output.args, patch)`
 * throws `TypeError: Attempted to assign to readonly property` on a frozen object.
 *
 * Keep the existing clone behavior only for frozen arguments. The host must
 * read the replacement back to execute that patch; mutable arguments are
 * updated in place so subsequent hooks and execution share the same object.
 */
export function replaceToolArgs(
	output: { args: Record<string, unknown> },
	patch: Record<string, unknown>,
): void {
	if (Object.isFrozen(output.args)) {
		output.args = { ...output.args, ...patch }
		return
	}
	Object.assign(output.args, patch)
}

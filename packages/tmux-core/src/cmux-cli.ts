/**
 * Resolve the cmux CLI used for `cmux __tmux-compat` delegation.
 * cmux does not put `cmux` on the agent process PATH; it exposes the binary
 * through `CMUX_OMO_CMUX_BIN` and its own tmux shim resolves it the same way,
 * so a bare `cmux` lookup fails with ENOENT when only the shim is on PATH.
 */
export function resolveCmuxCliExecutable(
	environment: Record<string, string | undefined> = process.env,
): string {
	return environment.CMUX_OMO_CMUX_BIN || environment.CMUX_BUNDLED_CLI_PATH || "cmux"
}

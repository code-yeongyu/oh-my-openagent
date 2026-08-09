/**
 * Detect whether we are running inside cmux (cmux omo-agent-toolkit).
 * When cmux-omo sets up the environment it injects a tmux shim and sets
 * CMUX_SOCKET_PATH / TMUX. If detected, redirect tmux commands to
 * `cmux __tmux-compat` so they become native cmux splits instead of
 * failing because there is no real tmux server running.
 */
export function isCmuxCompatEnvironment(
	environment: Record<string, string | undefined> = process.env,
): boolean {
	const tmuxEnvironment = environment.TMUX
	return tmuxEnvironment?.includes("cmuxterm") === true ||
		(Boolean(environment.CMUX_SOCKET_PATH) && !tmuxEnvironment)
}

const CMUX_EXECUTABLE_PATTERN = /^cmux(?:\.(?:bat|cmd|exe|ps1))?$/i
const TMUX_EXECUTABLE_PATTERN = /^tmux(?:\.exe)?$/i

export function isTmuxPathCompatibleWithBackend(tmuxPath: string, isCmux: boolean): boolean {
	const executableName = tmuxPath.split(/[\\/]/).pop() ?? ""
	if (CMUX_EXECUTABLE_PATTERN.test(executableName)) return isCmux
	if (TMUX_EXECUTABLE_PATTERN.test(executableName)) return !isCmux
	return true
}

export async function resolveStableTmuxBackend(
	getTmuxPath: () => Promise<string | null | undefined>,
	detectCmux: () => boolean = isCmuxCompatEnvironment,
): Promise<{ readonly isCmux: boolean; readonly path: string } | null> {
	const beforeLookup = detectCmux()
	const path = await getTmuxPath()
	const afterLookup = detectCmux()
	const backendPath = afterLookup && path === "tmux" ? "cmux" : path
	if (!backendPath || beforeLookup !== afterLookup || !isTmuxPathCompatibleWithBackend(backendPath, afterLookup)) {
		return null
	}
	return { isCmux: afterLookup, path: backendPath }
}

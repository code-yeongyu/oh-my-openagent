/**
 * Detect whether we are running inside cmux (cmux omo).
 * When cmux-omo sets up the environment it injects a tmux shim and sets
 * CMUX_SOCKET_PATH / TMUX. If detected, redirect tmux commands to
 * `cmux __tmux-compat` so they become native cmux splits instead of
 * failing because there is no real tmux server running.
 */
export function isCmuxCompatEnvironment(): boolean {
	const tmuxEnvironment = process.env.TMUX
	return tmuxEnvironment?.includes("cmuxterm") === true ||
		(Boolean(process.env.CMUX_SOCKET_PATH) && !tmuxEnvironment)
}

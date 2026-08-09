const CMUX_SOCKET_SEGMENT_PATTERN = /^cmux([-.]|$)/

/**
 * cmux injects `TMUX` as `<socket path>,<...>` with the socket under a `cmux*`
 * directory (`/tmp/cmux-omo/<workspace>,<surface>,<pane>`); a real tmux socket
 * lives under `tmux-<uid>` (`/private/tmp/tmux-501/default,123,0`). The socket
 * path, not the presence of `TMUX`, is what tells the two apart.
 *
 * Splitting is Unix-only on purpose: tmux and cmux both run only on Unix, where
 * `/` is the sole path separator and `\` is an ordinary filename character.
 * Treating `\` as a separator would let a real tmux socket such as
 * `/private/tmp/tmux-501/weird\cmux-omo` be misread as cmux and route every
 * tmux command through `cmux __tmux-compat`.
 */
function hasCmuxSocketPath(tmuxEnvironment: string): boolean {
	const socketPath = tmuxEnvironment.split(",")[0] ?? ""
	return socketPath.split("/").some((segment) => CMUX_SOCKET_SEGMENT_PATTERN.test(segment))
}

/**
 * Detect whether we are running inside cmux (cmux omo).
 * When cmux-omo sets up the environment it injects a tmux shim and sets
 * CMUX_SOCKET_PATH / TMUX. If detected, redirect tmux commands to
 * `cmux __tmux-compat` so they become native cmux splits instead of
 * failing because there is no real tmux server running.
 */
export function isCmuxCompatEnvironment(
	environment: Record<string, string | undefined> = process.env,
): boolean {
	const tmuxEnvironment = environment.TMUX
	if (tmuxEnvironment?.includes("cmuxterm") === true) return true
	if (!environment.CMUX_SOCKET_PATH) return false
	if (!tmuxEnvironment) return true
	return hasCmuxSocketPath(tmuxEnvironment)
}

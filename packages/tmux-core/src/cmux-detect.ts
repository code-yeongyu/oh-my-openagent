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
 *
 * `CMUX_SOCKET_PATH` is the single precondition and the socket path shape is
 * the only discriminator. An earlier `TMUX.includes("cmuxterm")` branch also
 * returned true, bypassing that precondition, but cmux writes `cmuxterm` only
 * into its bundle id (`com.cmuxterm.app`), its config directory (`~/.cmuxterm`)
 * and its own env names — never into a socket path, whose every release channel
 * is `cmux-` prefixed (`cmux-omo`, `cmux-nightly`, `cmux-staging`, `cmux-debug`).
 * The branch therefore never matched a real cmux session and only mislabelled
 * real tmux sessions whose name happened to contain `cmuxterm`.
 */
export function isCmuxCompatEnvironment(
	environment: Record<string, string | undefined> = process.env,
): boolean {
	if (!environment.CMUX_SOCKET_PATH) return false
	const tmuxEnvironment = environment.TMUX
	if (!tmuxEnvironment) return true
	return hasCmuxSocketPath(tmuxEnvironment)
}

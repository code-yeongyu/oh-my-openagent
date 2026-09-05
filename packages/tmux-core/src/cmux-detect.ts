const CMUX_SOCKET_SEGMENT_PATTERN = /^cmux([-.]|$)/

/**
 * `CMUX_AGENT_LAUNCH_KIND` names which agent cmux launched, and cmux ships a
 * wrapper shim per agent, so only `omo` carries the `CMUX_OMO_CMUX_BIN` contract
 * `resolveCmuxCliExecutable()` depends on. Matched exactly: a `claude`/`codex`
 * value means this process descends from another agent's launch.
 */
const CMUX_OMO_LAUNCH_KIND = "omo"

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
 * Precedence, highest first:
 *  1. the `TMUX` socket shape — the only ground truth, because `TMUX` names the
 *     socket we would actually talk to. A non-cmux shape is false outright.
 *  2. `CMUX_SOCKET_PATH` — the authenticated credential; on its own it is enough
 *     once 1 has not disqualified us.
 *  3. `CMUX_AGENT_LAUNCH_KIND === "omo"` — cmux's launch contract, accepted only
 *     as a stand-in for 2 and only where 1 independently confirms a cmux-shaped
 *     socket. Never sufficient alone, so an environment carrying nothing but the
 *     launch kind fails closed to native tmux.
 *
 * 3 is subordinate rather than authoritative because it is inherited: measured on
 * a live cmux host, starting a real tmux server inside a cmux pane leaves both
 * `CMUX_AGENT_LAUNCH_KIND` and `CMUX_SOCKET_PATH` untouched in the server's
 * children while only `TMUX` correctly changes to the real socket
 * (`/private/tmp/tmux-501/<session>,<pid>,0`). Promoting the launch kind above
 * the socket shape would therefore report nested real tmux as cmux and misroute
 * every command through `cmux __tmux-compat`.
 *
 * An earlier `TMUX.includes("cmuxterm")` branch returned true while bypassing
 * every credential, but cmux writes `cmuxterm` only into its bundle id
 * (`com.cmuxterm.app`), its config directory (`~/.cmuxterm`) and its own env
 * names — never into a socket path, which lives under `~/.local/state/cmux/` or
 * `/tmp/cmux-*` and is always `cmux-`/`cmux.` prefixed. The branch never matched
 * a real cmux session and only mislabelled real tmux sessions whose name
 * happened to contain `cmuxterm`.
 */
export function isCmuxCompatEnvironment(
	environment: Record<string, string | undefined> = process.env,
): boolean {
	const tmuxEnvironment = environment.TMUX
	if (!tmuxEnvironment) return Boolean(environment.CMUX_SOCKET_PATH)
	if (!hasCmuxSocketPath(tmuxEnvironment)) return false
	return (
		Boolean(environment.CMUX_SOCKET_PATH) ||
		environment.CMUX_AGENT_LAUNCH_KIND === CMUX_OMO_LAUNCH_KIND
	)
}

import { runTmuxCommand, type TmuxCommandResult } from "@oh-my-opencode/tmux-core"

type ResolvedCallerTmuxSession = {
	sessionId: string
	paneId: string
	windowTarget: string
}

type RunTmuxCommand = (tmuxPath: string, args: string[]) => Promise<TmuxCommandResult>

const TMUX_SESSION_ID_PATTERN = /^\$[0-9]+$/
const TMUX_WINDOW_TARGET_PATTERN = /^[^:]+:[0-9]+$/

export async function resolveCallerTmuxSession(
	tmuxPath: string,
	callerPaneId: string | undefined = process.env.TMUX_PANE,
	runCommand: RunTmuxCommand = runTmuxCommand,
): Promise<ResolvedCallerTmuxSession | null> {
	if (!callerPaneId) {
		return null
	}

	const sessionResult = await runCommand(tmuxPath, ["display", "-p", "-F", "#{session_id}", "-t", callerPaneId])
	if (!sessionResult.success) {
		return null
	}

	const sessionId = sessionResult.output.trim()
	if (!TMUX_SESSION_ID_PATTERN.test(sessionId)) {
		return null
	}

	const windowResult = await runCommand(tmuxPath, ["display", "-p", "-F", "#{session_name}:#{window_index}", "-t", callerPaneId])
	if (!windowResult.success) {
		return null
	}

	const windowTarget = windowResult.output.trim()
	if (!TMUX_WINDOW_TARGET_PATTERN.test(windowTarget)) {
		return null
	}

	return { sessionId, paneId: callerPaneId, windowTarget }
}

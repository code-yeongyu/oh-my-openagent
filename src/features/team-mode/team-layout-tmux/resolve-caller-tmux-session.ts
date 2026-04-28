import { runTmuxCommand } from "../../../shared/tmux"

type ResolvedCallerTmuxSession = {
	sessionId: string
}

const TMUX_SESSION_ID_PATTERN = /^\$[0-9]+$/

export async function resolveCallerTmuxSession(tmuxPath: string): Promise<ResolvedCallerTmuxSession | null> {
	const callerPaneId = process.env.TMUX_PANE
	if (!callerPaneId) {
		return null
	}

	const result = await runTmuxCommand(tmuxPath, ["display", "-p", "-F", "#{session_id}", "-t", callerPaneId])
	if (!result.success) {
		return null
	}

	const sessionId = result.output.trim()
	if (!TMUX_SESSION_ID_PATTERN.test(sessionId)) {
		return null
	}

	return { sessionId }
}

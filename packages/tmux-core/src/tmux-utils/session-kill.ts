import { runTmuxCommand } from "../runner"
import { isInsideTmux } from "./environment"

export type KillTmuxSessionDeps = {
	readonly isInsideTmux: () => boolean
	readonly getTmuxPath: () => Promise<string | null | undefined>
	readonly runTmuxCommand: typeof runTmuxCommand
	readonly log: (message: string, data?: unknown) => void
}

export async function killTmuxSessionIfExists(
	sessionName: string,
	deps: KillTmuxSessionDeps = {
		isInsideTmux,
		getTmuxPath: async () => null,
		runTmuxCommand,
		log: () => undefined,
	},
): Promise<boolean> {
	if (!deps.isInsideTmux()) {
		deps.log("[killTmuxSessionIfExists] SKIP: not inside tmux", { sessionName })
		return false
	}

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		deps.log("[killTmuxSessionIfExists] SKIP: tmux not found", { sessionName })
		return false
	}

  const hasSessionResult = await deps.runTmuxCommand(tmux, ["has-session", "-t", sessionName])

	if (hasSessionResult.exitCode !== 0) {
		deps.log("[killTmuxSessionIfExists] SKIP: session not found", { sessionName })
		return false
	}

  const killSessionResult = await deps.runTmuxCommand(tmux, ["kill-session", "-t", sessionName])

	if (killSessionResult.exitCode !== 0) {
		deps.log("[killTmuxSessionIfExists] FAILED", {
			sessionName,
			exitCode: killSessionResult.exitCode,
			stderr: killSessionResult.stderr.trim(),
		})
		return false
	}

	deps.log("[killTmuxSessionIfExists] SUCCESS", { sessionName })
	return true
}

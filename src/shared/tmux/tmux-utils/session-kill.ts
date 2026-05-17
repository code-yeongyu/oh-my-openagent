export async function killTmuxSessionIfExists(sessionName: string): Promise<boolean> {
	const [{ log }, { isInsideTmux }, { getTmuxPath }, { runTmuxCommand }] = await Promise.all([
		import("../../logger"),
		import("./environment"),
		import("../../../tools/interactive-bash/tmux-path-resolver"),
		import("../runner"),
	])

	if (!isInsideTmux()) {
		log("[killTmuxSessionIfExists] SKIP: not inside tmux", { sessionName })
		return false
	}

	const tmux = await getTmuxPath()
	if (!tmux) {
		log("[killTmuxSessionIfExists] SKIP: tmux not found", { sessionName })
		return false
	}

 	const hasSessionResult = await runTmuxCommand(tmux, ["has-session", "-t", sessionName])

	if (hasSessionResult.exitCode !== 0) {
		log("[killTmuxSessionIfExists] SKIP: session not found", { sessionName })
		return false
	}

 	const killSessionResult = await runTmuxCommand(tmux, ["kill-session", "-t", sessionName])

	if (killSessionResult.exitCode !== 0) {
		log("[killTmuxSessionIfExists] FAILED", {
			sessionName,
			exitCode: killSessionResult.exitCode,
			stderr: killSessionResult.stderr.trim(),
		})
		return false
	}

	log("[killTmuxSessionIfExists] SUCCESS", { sessionName })
	return true
}

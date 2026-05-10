function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function closeTmuxPane(paneId: string): Promise<boolean> {
	const [{ log }, { isInsideTmux }, { getTmuxPath }, { runTmuxCommand }] = await Promise.all([
		import("../../logger"),
		import("./environment"),
		import("../../../tools/interactive-bash/tmux-path-resolver"),
		import("../runner"),
	])

	if (!isInsideTmux()) {
		log("[closeTmuxPane] SKIP: not inside tmux")
		return false
	}

	const tmux = await getTmuxPath()
	if (!tmux) {
		log("[closeTmuxPane] SKIP: tmux not found")
		return false
	}

	log("[closeTmuxPane] sending Ctrl+C for graceful shutdown", { paneId })
	await runTmuxCommand(tmux, ["send-keys", "-t", paneId, "C-c"])

	await delay(250)

	log("[closeTmuxPane] killing pane", { paneId })

	const result = await runTmuxCommand(tmux, ["kill-pane", "-t", paneId])
	const trimmedStderr = result.stderr.trim()
	const paneAlreadyGone = result.exitCode !== 0 && /can't find pane/i.test(trimmedStderr)

	if (paneAlreadyGone) {
		log("[closeTmuxPane] SUCCESS (pane already closed by Ctrl+C)", { paneId })
		return true
	}

	if (result.exitCode !== 0) {
		log("[closeTmuxPane] FAILED", { paneId, exitCode: result.exitCode, stderr: trimmedStderr })
		return false
	}

	log("[closeTmuxPane] SUCCESS", { paneId })
	return true
}

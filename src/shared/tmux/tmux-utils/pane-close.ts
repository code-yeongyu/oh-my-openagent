function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

async function readStream(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
	return stream ? new Response(stream).text() : ""
}

export async function closeTmuxPane(paneId: string): Promise<boolean> {
	const [{ log }, { isInsideTmux }, { getTmuxPath }, { spawn }] = await Promise.all([
		import("../../logger"),
		import("./environment"),
		import("../../../tools/interactive-bash/tmux-path-resolver"),
		import("./spawn-process"),
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
	const ctrlCProc = spawn([tmux, "send-keys", "-t", paneId, "C-c"], {
		stdout: "ignore",
		stderr: "ignore",
	})
	await ctrlCProc.exited

	await delay(250)

	log("[closeTmuxPane] killing pane", { paneId })

	const killPaneProc = spawn([tmux, "kill-pane", "-t", paneId], {
		stdout: "pipe",
		stderr: "pipe",
	})
	const [, stderr, exitCode] = await Promise.all([
		readStream(killPaneProc.stdout),
		readStream(killPaneProc.stderr),
		killPaneProc.exited,
	])

	const trimmedStderr = stderr.trim()
	const paneAlreadyGone = exitCode !== 0 && /can't find pane/i.test(trimmedStderr)

	if (paneAlreadyGone) {
		log("[closeTmuxPane] SUCCESS (pane already closed by Ctrl+C)", { paneId })
		return true
	}

	if (exitCode !== 0) {
		log("[closeTmuxPane] FAILED", { paneId, exitCode, stderr: trimmedStderr })
		return false
	}

	log("[closeTmuxPane] SUCCESS", { paneId })
	return true
}

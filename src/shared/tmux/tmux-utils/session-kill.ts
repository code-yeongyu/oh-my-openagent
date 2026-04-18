async function readStream(stream: ReadableStream<Uint8Array> | null | undefined): Promise<string> {
	return stream ? new Response(stream).text() : ""
}

export async function killTmuxSessionIfExists(sessionName: string): Promise<boolean> {
	const [{ log }, { isInsideTmux }, { getTmuxPath }, { spawn }] = await Promise.all([
		import("../../logger"),
		import("./environment"),
		import("../../../tools/interactive-bash/tmux-path-resolver"),
		import("./spawn-process"),
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

	const hasSessionProcess = spawn([tmux, "has-session", "-t", sessionName], {
		stdout: "ignore",
		stderr: "ignore",
	})

	if ((await hasSessionProcess.exited) !== 0) {
		log("[killTmuxSessionIfExists] SKIP: session not found", { sessionName })
		return false
	}

	const killSessionProcess = spawn([tmux, "kill-session", "-t", sessionName], {
		stdout: "pipe",
		stderr: "pipe",
	})
	const [, stderr, exitCode] = await Promise.all([
		readStream(killSessionProcess.stdout),
		readStream(killSessionProcess.stderr),
		killSessionProcess.exited,
	])

	if (exitCode !== 0) {
		log("[killTmuxSessionIfExists] FAILED", { sessionName, exitCode, stderr: stderr.trim() })
		return false
	}

	log("[killTmuxSessionIfExists] SUCCESS", { sessionName })
	return true
}

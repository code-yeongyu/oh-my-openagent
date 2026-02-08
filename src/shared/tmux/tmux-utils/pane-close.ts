import { spawn } from "bun"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import { isInsideTmux } from "./environment"

function delay(milliseconds: number): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, milliseconds))
}

export async function closeTmuxPane(paneId: string): Promise<boolean> {
	const { log } = await import("../../logger")

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
		stdout: "pipe",
		stderr: "pipe",
	})
	await ctrlCProc.exited

	await delay(250)

	log("[closeTmuxPane] killing pane", { paneId })

	const proc = spawn([tmux, "kill-pane", "-t", paneId], {
		stdout: "pipe",
		stderr: "pipe",
	})
	const exitCode = await proc.exited
	const stderr = await new Response(proc.stderr).text()

	if (exitCode !== 0) {
		log("[closeTmuxPane] FAILED", { paneId, exitCode, stderr: stderr.trim() })
	} else {
		log("[closeTmuxPane] SUCCESS", { paneId })
	}

	return exitCode === 0
}

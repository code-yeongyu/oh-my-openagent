import { spawn } from "bun"
import type { TmuxConfig } from "../../../config/schema"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import type { SpawnPaneResult } from "../types"
import { isInsideTmux } from "./environment"
import { buildOpencodeAttachCommand } from "./pane-command"

export async function activateTmuxPane(
	paneId: string,
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
): Promise<SpawnPaneResult> {
	const { log } = await import("../../logger")

	if (!config.enabled || !isInsideTmux()) {
		return { success: false }
	}

	const tmux = await getTmuxPath()
	if (!tmux) {
		return { success: false }
	}

	const opencodeCmd = buildOpencodeAttachCommand(serverUrl, sessionId)
	const proc = spawn([tmux, "respawn-pane", "-k", "-t", paneId, opencodeCmd], {
		stdout: "pipe",
		stderr: "pipe",
	})
	const exitCode = await proc.exited

	if (exitCode !== 0) {
		const stderr = await new Response(proc.stderr).text()
		log("[activateTmuxPane] FAILED", { paneId, sessionId, exitCode, stderr: stderr.trim() })
		return { success: false }
	}

	const title = `omo-subagent-${description.slice(0, 20)}`
	const titleProc = spawn([tmux, "select-pane", "-t", paneId, "-T", title], {
		stdout: "ignore",
		stderr: "pipe",
	})
	const stderrPromise = new Response(titleProc.stderr).text().catch(() => "")
	const titleExitCode = await titleProc.exited
	if (titleExitCode !== 0) {
		const titleStderr = await stderrPromise
		log("[activateTmuxPane] WARNING: failed to set pane title", {
			paneId,
			title,
			exitCode: titleExitCode,
			stderr: titleStderr.trim(),
		})
	}

	log("[activateTmuxPane] SUCCESS", { paneId, sessionId })
	return { success: true, paneId }
}

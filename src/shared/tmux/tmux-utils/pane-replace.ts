import type { TmuxConfig } from "../../../config/schema"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import type { SpawnPaneResult } from "../types"
import { isInsideTmux } from "./environment"
import { shellSingleQuote } from "../../shell-env"

export async function replaceTmuxPane(
	paneId: string,
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
	directory: string,
): Promise<SpawnPaneResult> {
	const [{ log }, { runTmuxCommand }] = await Promise.all([
		import("../../logger"),
		import("../runner"),
	])

	log("[replaceTmuxPane] called", { paneId, sessionId, description })

	if (!config.enabled) {
		return { success: false }
	}
	if (!isInsideTmux()) {
		return { success: false }
	}

	const tmux = await getTmuxPath()
	if (!tmux) {
		return { success: false }
	}

	log("[replaceTmuxPane] sending Ctrl+C for graceful shutdown", { paneId })
	await runTmuxCommand(tmux, ["send-keys", "-t", paneId, "C-c"])

	const effectiveDirectory = directory || process.cwd()
	const opencodeCmd = `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(sessionId)} --dir ${shellSingleQuote(effectiveDirectory)}`

	const result = await runTmuxCommand(tmux, ["respawn-pane", "-k", "-t", paneId, opencodeCmd])

	if (result.exitCode !== 0) {
		log("[replaceTmuxPane] FAILED", { paneId, exitCode: result.exitCode, stderr: result.stderr.trim() })
		return { success: false }
	}

	const title = `omo-subagent-${description.slice(0, 20)}`
	const titleResult = await runTmuxCommand(tmux, ["select-pane", "-t", paneId, "-T", title])
	if (titleResult.exitCode !== 0) {
		log("[replaceTmuxPane] WARNING: failed to set pane title", {
			paneId,
			title,
			exitCode: titleResult.exitCode,
			stderr: titleResult.stderr.trim(),
		})
	}

	log("[replaceTmuxPane] SUCCESS", { paneId, sessionId })
	return { success: true, paneId }
}

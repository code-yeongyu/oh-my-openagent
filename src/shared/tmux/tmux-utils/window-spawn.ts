import { spawn } from "bun"
import type { TmuxConfig } from "../../../config/schema"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import type { SpawnPaneResult } from "../types"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import { shellEscapeForDoubleQuotedCommand } from "../../shell-env"

const ISOLATED_WINDOW_NAME = "omo-agents"

export async function spawnTmuxWindow(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
): Promise<SpawnPaneResult> {
	const { log } = await import("../../logger")

	log("[spawnTmuxWindow] called", {
		sessionId,
		description,
		serverUrl,
		configEnabled: config.enabled,
	})

	if (!config.enabled) {
		log("[spawnTmuxWindow] SKIP: config.enabled is false")
		return { success: false }
	}
	if (!isInsideTmux()) {
		log("[spawnTmuxWindow] SKIP: not inside tmux", { TMUX: process.env.TMUX })
		return { success: false }
	}

	const serverRunning = await isServerRunning(serverUrl)
	if (!serverRunning) {
		log("[spawnTmuxWindow] SKIP: server not running", { serverUrl })
		return { success: false }
	}

	const tmux = await getTmuxPath()
	if (!tmux) {
		log("[spawnTmuxWindow] SKIP: tmux not found")
		return { success: false }
	}

	log("[spawnTmuxWindow] all checks passed, creating isolated window...")

	const shell = process.env.SHELL || "/bin/sh"
	const escapedUrl = shellEscapeForDoubleQuotedCommand(serverUrl)
	const escapedSessionId = shellEscapeForDoubleQuotedCommand(sessionId)
	const opencodeCmd = `${shell} -c "opencode attach ${escapedUrl} --session ${escapedSessionId}"`

	const args = [
		"new-window",
		"-d",
		"-n", ISOLATED_WINDOW_NAME,
		"-P",
		"-F", "#{pane_id}",
		opencodeCmd,
	]

	const proc = spawn([tmux, ...args], { stdout: "pipe", stderr: "pipe" })
	const exitCode = await proc.exited
	const stdout = await new Response(proc.stdout).text()
	const paneId = stdout.trim()

	if (exitCode !== 0 || !paneId) {
		const stderr = await new Response(proc.stderr).text()
		log("[spawnTmuxWindow] FAILED", { exitCode, stderr: stderr.trim() })
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
		log("[spawnTmuxWindow] WARNING: failed to set pane title", {
			paneId,
			title,
			exitCode: titleExitCode,
			stderr: titleStderr.trim(),
		})
	}

	log("[spawnTmuxWindow] SUCCESS", { paneId, windowName: ISOLATED_WINDOW_NAME })
	return { success: true, paneId }
}

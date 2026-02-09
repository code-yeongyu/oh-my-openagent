import { spawn } from "bun"
import type { TmuxConfig } from "../../../config/schema"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import type { SpawnPaneResult } from "../types"
import type { SplitDirection } from "./environment"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"

export async function spawnTmuxPane(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
	targetPaneId?: string,
	splitDirection: SplitDirection = "-h",
): Promise<SpawnPaneResult> {
	const { log } = await import("../../logger")

	log("[spawnTmuxPane] called", {
		sessionId,
		description,
		serverUrl,
		configEnabled: config.enabled,
		targetPaneId,
		splitDirection,
	})

	if (!config.enabled) {
		log("[spawnTmuxPane] SKIP: config.enabled is false")
		return { success: false }
	}
	if (!isInsideTmux()) {
		log("[spawnTmuxPane] SKIP: not inside tmux", { TMUX: process.env.TMUX })
		return { success: false }
	}

	const serverRunning = await isServerRunning(serverUrl)
	if (!serverRunning) {
		log("[spawnTmuxPane] SKIP: server not running", { serverUrl })
		return { success: false }
	}

	const tmux = await getTmuxPath()
	if (!tmux) {
		log("[spawnTmuxPane] SKIP: tmux not found")
		return { success: false }
	}

	log("[spawnTmuxPane] all checks passed, spawning...")

	const opencodeCmd = `opencode attach ${serverUrl} --session ${sessionId}`

	const args = [
		"split-window",
		splitDirection,
		"-d",
		"-P",
		"-F",
		"#{pane_id}",
		...(targetPaneId ? ["-t", targetPaneId] : []),
		opencodeCmd,
	]

	const proc = spawn([tmux, ...args], { stdout: "pipe", stderr: "pipe" })
	const exitCode = await proc.exited
	const stdout = await new Response(proc.stdout).text()
	const paneId = stdout.trim()

	if (exitCode !== 0 || !paneId) {
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
		log("[spawnTmuxPane] WARNING: failed to set pane title", {
			paneId,
			title,
			exitCode: titleExitCode,
			stderr: titleStderr.trim(),
		})
	}

	return { success: true, paneId }
}

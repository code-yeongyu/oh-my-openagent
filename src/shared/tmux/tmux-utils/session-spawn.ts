import type { TmuxConfig } from "../../../config/schema"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import type { SpawnPaneResult } from "../types"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import { shellSingleQuote } from "../../shell-env"

const ISOLATED_SESSION_NAME_PREFIX = "omo-agents"

export function getIsolatedSessionName(pid: number = process.pid): string {
	return `${ISOLATED_SESSION_NAME_PREFIX}-${pid}`
}

async function getWindowDimensions(
	tmux: string,
	sourcePaneId: string,
	runTmuxCommand: typeof RunTmuxCommand,
): Promise<{ width: number; height: number } | null> {
	const result = await runTmuxCommand(tmux, ["display", "-p", "-t", sourcePaneId, "#{window_width},#{window_height}"])

	if (result.exitCode !== 0) return null

	const [width, height] = result.output.trim().split(",").map(Number)
	if (Number.isNaN(width) || Number.isNaN(height)) return null

	return { width, height }
}

async function sessionExists(tmux: string, sessionName: string, runTmuxCommand: typeof RunTmuxCommand): Promise<boolean> {
	const result = await runTmuxCommand(tmux, ["has-session", "-t", sessionName])
	return result.exitCode === 0
}

export async function spawnTmuxSession(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
	directory: string,
	sourcePaneId?: string,
): Promise<SpawnPaneResult> {
	const [{ log }, { runTmuxCommand }] = await Promise.all([
		import("../../logger"),
		import("../runner"),
	])

	log("[spawnTmuxSession] called", {
		sessionId,
		description,
		serverUrl,
		configEnabled: config.enabled,
	})

	if (!config.enabled) {
		log("[spawnTmuxSession] SKIP: config.enabled is false")
		return { success: false }
	}
	if (!isInsideTmux()) {
		log("[spawnTmuxSession] SKIP: not inside tmux", { TMUX: process.env.TMUX })
		return { success: false }
	}

	const serverRunning = await isServerRunning(serverUrl)
	if (!serverRunning) {
		log("[spawnTmuxSession] SKIP: server not running", { serverUrl })
		return { success: false }
	}

	const tmux = await getTmuxPath()
	if (!tmux) {
		log("[spawnTmuxSession] SKIP: tmux not found")
		return { success: false }
	}

	log("[spawnTmuxSession] all checks passed, creating isolated session...")

	const effectiveDirectory = directory || process.cwd()
	const opencodeCmd = `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(sessionId)} --dir ${shellSingleQuote(effectiveDirectory)}`

	const sizeArgs: string[] = []
	if (sourcePaneId) {
		const dims = await getWindowDimensions(tmux, sourcePaneId, runTmuxCommand)
		if (dims) {
			sizeArgs.push("-x", String(dims.width), "-y", String(dims.height))
		}
	}

	const isolatedSessionName = getIsolatedSessionName()
	const sessionAlreadyExists = await sessionExists(tmux, isolatedSessionName, runTmuxCommand)

	const args = sessionAlreadyExists
		? [
			"new-window",
			"-t", isolatedSessionName,
			"-P",
			"-F", "#{pane_id}",
			opencodeCmd,
		]
		: [
			"new-session",
			"-d",
			"-s", isolatedSessionName,
			...sizeArgs,
			"-P",
			"-F", "#{pane_id}",
			opencodeCmd,
		]

	log("[spawnTmuxSession] spawning", {
		mode: sessionAlreadyExists ? "new-window" : "new-session",
		sessionName: isolatedSessionName,
	})

	const result = await runTmuxCommand(tmux, args)
	const paneId = result.output

	if (result.exitCode !== 0 || !paneId) {
		log("[spawnTmuxSession] FAILED", { exitCode: result.exitCode, stderr: result.stderr.trim() })
		return { success: false }
	}

	const title = `omo-subagent-${description.slice(0, 20)}`
	const titleResult = await runTmuxCommand(tmux, ["select-pane", "-t", paneId, "-T", title])
	if (titleResult.exitCode !== 0) {
		log("[spawnTmuxSession] WARNING: failed to set pane title", {
			paneId,
			title,
			exitCode: titleResult.exitCode,
			stderr: titleResult.stderr.trim(),
		})
	}

	log("[spawnTmuxSession] SUCCESS", { paneId, sessionName: isolatedSessionName })
	return { success: true, paneId }
}

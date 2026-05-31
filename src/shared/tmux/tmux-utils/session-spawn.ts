import type { TmuxConfig } from "../../../config/schema"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import type { SpawnPaneResult } from "../types"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import { buildTmuxPlaceholderCommand } from "./pane-command"

const ISOLATED_SESSION_NAME_PREFIX = "omo-agents"

type SpawnTmuxSessionDeps = {
	log: (message: string, data?: unknown) => void
	runTmuxCommand: typeof RunTmuxCommand
	isInsideTmux: typeof isInsideTmux
	isServerRunning: typeof isServerRunning
	getTmuxPath: typeof getTmuxPath
}

async function resolveSpawnTmuxSessionDeps(deps?: Partial<SpawnTmuxSessionDeps>): Promise<SpawnTmuxSessionDeps> {
	const [{ log }, { runTmuxCommand }] = await Promise.all([
		import("../../logger"),
		import("../runner"),
	])

	return {
		log,
		runTmuxCommand,
		isInsideTmux,
		isServerRunning,
		getTmuxPath,
		...deps,
	}
}

export function getIsolatedSessionName(pid: number = process.pid, managerId?: string): string {
	return managerId
		? `${ISOLATED_SESSION_NAME_PREFIX}-${pid}-${managerId}`
		: `${ISOLATED_SESSION_NAME_PREFIX}-${pid}`
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
	_directory: string,
	sourcePaneId?: string,
	depsInput?: Partial<SpawnTmuxSessionDeps>,
	managerId?: string,
): Promise<SpawnPaneResult> {
	const deps = await resolveSpawnTmuxSessionDeps(depsInput)
	const { log, runTmuxCommand } = deps

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
	if (!deps.isInsideTmux()) {
		log("[spawnTmuxSession] SKIP: not inside tmux", { TMUX: process.env.TMUX })
		return { success: false }
	}

	const serverRunning = await deps.isServerRunning(serverUrl)
	if (!serverRunning) {
		log("[spawnTmuxSession] SKIP: server not running", { serverUrl })
		return { success: false }
	}

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		log("[spawnTmuxSession] SKIP: tmux not found")
		return { success: false }
	}

	log("[spawnTmuxSession] all checks passed, creating isolated session...")

	const placeholderCmd = buildTmuxPlaceholderCommand(description)

	const sizeArgs: string[] = []
	if (sourcePaneId) {
		const dims = await getWindowDimensions(tmux, sourcePaneId, runTmuxCommand)
		if (dims) {
			sizeArgs.push("-x", String(dims.width), "-y", String(dims.height))
		}
	}

	const isolatedSessionName = getIsolatedSessionName(process.pid, managerId)
	const sessionAlreadyExists = await sessionExists(tmux, isolatedSessionName, runTmuxCommand)

	const args = sessionAlreadyExists
		? [
			"new-window",
			"-t", isolatedSessionName,
			"-P",
			"-F", "#{pane_id}",
			placeholderCmd,
		]
		: [
			"new-session",
			"-d",
			"-s", isolatedSessionName,
			...sizeArgs,
			"-P",
			"-F", "#{pane_id}",
			placeholderCmd,
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

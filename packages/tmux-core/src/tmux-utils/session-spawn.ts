import type { TmuxConfig } from "../types"
import type { SpawnPaneResult } from "../types"
import type { TmuxServerTarget } from "../types"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"
import { getHttpServerOriginForLog, normalizeTmuxServerTarget } from "../tmux-server-target"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import { buildTmuxEnvironmentArgs, buildTmuxPlaceholderCommand } from "./pane-command"

const ISOLATED_SESSION_NAME_PREFIX = "omo-agents"

export type SpawnTmuxSessionDeps = {
	readonly log: (message: string, data?: unknown) => void
	readonly runTmuxCommand: typeof RunTmuxCommand
	readonly isInsideTmux: typeof isInsideTmux
	readonly isServerRunning: typeof isServerRunning
	readonly getTmuxPath: () => Promise<string | null | undefined>
}

async function resolveSpawnTmuxSessionDeps(deps?: Partial<SpawnTmuxSessionDeps>): Promise<SpawnTmuxSessionDeps> {
	const { runTmuxCommand } = await import("../runner")

	return {
		log: () => undefined,
		runTmuxCommand,
		isInsideTmux,
		isServerRunning,
		getTmuxPath: async () => null,
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
	serverTarget: TmuxServerTarget,
	_directory: string,
	sourcePaneId?: string,
	depsInput?: Partial<SpawnTmuxSessionDeps>,
	managerId?: string,
): Promise<SpawnPaneResult> {
	const deps = await resolveSpawnTmuxSessionDeps(depsInput)
	const { log, runTmuxCommand } = deps
	const serverAccess = normalizeTmuxServerTarget(serverTarget, depsInput?.isServerRunning)
	const serverOrigin = getHttpServerOriginForLog(serverAccess.serverUrl)

	log("[spawnTmuxSession] called", {
		sessionId,
		description,
		serverOrigin,
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

	const serverRunning = await serverAccess.checkServerHealth()
	if (!serverRunning) {
		log("[spawnTmuxSession] SKIP: server listener not ready", { serverOrigin })
		return { success: false }
	}

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		log("[spawnTmuxSession] SKIP: tmux not found")
		return { success: false }
	}

	log("[spawnTmuxSession] all checks passed, creating isolated session...")

	const placeholderCmd = buildTmuxPlaceholderCommand(description)
	const paneEnvironmentArgs = buildTmuxEnvironmentArgs(serverAccess.getPaneEnvironment())

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
			...paneEnvironmentArgs,
			placeholderCmd,
		]
		: [
			"new-session",
			"-d",
			"-s", isolatedSessionName,
			...sizeArgs,
			"-P",
			"-F", "#{pane_id}",
			...paneEnvironmentArgs,
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

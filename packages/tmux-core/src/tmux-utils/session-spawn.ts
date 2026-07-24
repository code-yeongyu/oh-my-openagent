import type { TmuxConfig } from "../types"
import type { SpawnPaneResult } from "../types"
import type { TmuxServerTarget } from "../types"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"
import { isCmuxCompatEnvironment, isTmuxPathCompatibleWithBackend, resolveStableTmuxBackend } from "../cmux-detect"
import { getHttpServerOriginForLog, normalizeTmuxServerTarget } from "../tmux-server-target"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import {
	buildTmuxPlaceholderCommand,
	planTmuxPaneEnvironment,
	TMUX_BACKEND_MISMATCH_ERROR,
	TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR,
} from "./pane-command"

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

function blockedTmuxCommandResult(stderr = TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR): Awaited<ReturnType<typeof RunTmuxCommand>> {
	return {
		success: false,
		output: "",
		stdout: "",
		stderr,
		exitCode: 1,
	}
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

	if (isCmuxCompatEnvironment() && !planTmuxPaneEnvironment(serverAccess.getPaneEnvironment(), true)) {
		log("[spawnTmuxSession] SKIP: pane environment cannot be safely omitted under cmux")
		return { success: false }
	}

	const backend = await resolveStableTmuxBackend(deps.getTmuxPath)
	if (!backend) {
		log("[spawnTmuxSession] SKIP: tmux backend changed or executable was unavailable")
		return { success: false }
	}

	log("[spawnTmuxSession] all checks passed, creating isolated session...")

	const placeholderCmd = buildTmuxPlaceholderCommand(description)
	const guardedRunTmuxCommand: typeof RunTmuxCommand = (tmuxPath, args, options) => {
		const currentIsCmux = isCmuxCompatEnvironment()
		if (currentIsCmux !== backend.isCmux || !isTmuxPathCompatibleWithBackend(tmuxPath, currentIsCmux)) {
			return Promise.resolve(blockedTmuxCommandResult(TMUX_BACKEND_MISMATCH_ERROR))
		}
		if (!currentIsCmux) return runTmuxCommand(tmuxPath, args, options)
		return planTmuxPaneEnvironment(serverAccess.getPaneEnvironment(), true)
			? runTmuxCommand(tmuxPath, args, options)
			: Promise.resolve(blockedTmuxCommandResult())
	}

	const sizeArgs: string[] = []
	if (sourcePaneId) {
		const dims = await getWindowDimensions(backend.path, sourcePaneId, guardedRunTmuxCommand)
		if (dims) {
			sizeArgs.push("-x", String(dims.width), "-y", String(dims.height))
		}
	}

	const isolatedSessionName = getIsolatedSessionName(process.pid, managerId)
	const sessionAlreadyExists = await sessionExists(backend.path, isolatedSessionName, guardedRunTmuxCommand)
	const currentIsCmux = isCmuxCompatEnvironment()
	if (currentIsCmux !== backend.isCmux || !isTmuxPathCompatibleWithBackend(backend.path, currentIsCmux)) {
		log(`[spawnTmuxSession] SKIP: ${TMUX_BACKEND_MISMATCH_ERROR}`)
		return { success: false }
	}
	const environmentPlan = planTmuxPaneEnvironment(serverAccess.getPaneEnvironment(), currentIsCmux)
	if (!environmentPlan) {
		log(`[spawnTmuxSession] SKIP: ${TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR}`)
		return { success: false }
	}

	const args = sessionAlreadyExists
		? [
			"new-window",
			"-t", isolatedSessionName,
			"-P",
			"-F", "#{pane_id}",
			...environmentPlan.args,
			placeholderCmd,
		]
		: [
			"new-session",
			"-d",
			"-s", isolatedSessionName,
			...sizeArgs,
			"-P",
			"-F", "#{pane_id}",
			...environmentPlan.args,
			placeholderCmd,
		]

	log("[spawnTmuxSession] spawning", {
		mode: sessionAlreadyExists ? "new-window" : "new-session",
		sessionName: isolatedSessionName,
	})

	const result = await runTmuxCommand(backend.path, args)
	const paneId = result.output

	if (result.exitCode !== 0 || !paneId) {
		log("[spawnTmuxSession] FAILED", { exitCode: result.exitCode, stderr: result.stderr.trim() })
		return { success: false }
	}

	const title = `omo-subagent-${description.slice(0, 20)}`
	const titleIsCmux = isCmuxCompatEnvironment()
	const titleBlockReason = titleIsCmux !== backend.isCmux ||
		!isTmuxPathCompatibleWithBackend(backend.path, titleIsCmux)
		? TMUX_BACKEND_MISMATCH_ERROR
		: titleIsCmux && !planTmuxPaneEnvironment(serverAccess.getPaneEnvironment(), true)
			? TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR
			: undefined
	const titleResult = titleBlockReason === undefined
		? await runTmuxCommand(backend.path, ["select-pane", "-t", paneId, "-T", title])
		: { exitCode: 1, stderr: titleBlockReason }
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

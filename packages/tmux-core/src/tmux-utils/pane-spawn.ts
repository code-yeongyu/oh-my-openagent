import type { TmuxConfig } from "../types"
import type { SpawnPaneResult } from "../types"
import type { TmuxServerTarget } from "../types"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"
import {
	getHttpServerOriginForLog,
	getReadyTmuxPaneEnvironment,
	normalizeTmuxServerTarget,
} from "../tmux-server-target"
import type { SplitDirection } from "./environment"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import {
	applyTmuxPaneEnvironmentToCommand,
	buildTmuxAttachCommand,
	buildTmuxPlaceholderCommand,
	planTmuxPaneEnvironment,
	TMUX_BACKEND_MISMATCH_ERROR,
	TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR,
} from "./pane-command"
import {
	isCmuxCompatEnvironment as _isCmuxCompatEnvironment,
	isTmuxPathCompatibleWithBackend,
	resolveStableTmuxBackend,
} from "../cmux-detect"

export type SpawnTmuxPaneDeps = {
	readonly log: (message: string, data?: unknown) => void
	readonly runTmuxCommand: typeof RunTmuxCommand
	readonly isInsideTmux: typeof isInsideTmux
	readonly isServerRunning: typeof isServerRunning
	readonly getTmuxPath: () => Promise<string | null | undefined>
	readonly isCmuxCompatEnvironment: () => boolean
}

async function resolveSpawnTmuxPaneDeps(deps?: Partial<SpawnTmuxPaneDeps>): Promise<SpawnTmuxPaneDeps> {
	const { runTmuxCommand } = await import("../runner")

	return {
		log: () => undefined,
		runTmuxCommand,
		isInsideTmux,
		isServerRunning,
		getTmuxPath: async () => null,
		isCmuxCompatEnvironment: _isCmuxCompatEnvironment,
		...deps,
	}
}

export async function spawnTmuxPane(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverTarget: TmuxServerTarget,
	_directory: string,
	targetPaneId?: string,
	splitDirection: SplitDirection = "-h",
	depsInput?: Partial<SpawnTmuxPaneDeps>,
): Promise<SpawnPaneResult> {
	const deps = await resolveSpawnTmuxPaneDeps(depsInput)
	const { log, runTmuxCommand } = deps
	const serverAccess = normalizeTmuxServerTarget(serverTarget, depsInput?.isServerRunning)
	const serverOrigin = getHttpServerOriginForLog(serverAccess.serverUrl)

	log("[spawnTmuxPane] called", {
		sessionId,
		description,
		serverOrigin,
		configEnabled: config.enabled,
		targetPaneId,
		splitDirection,
	})

	if (!config.enabled) {
		log("[spawnTmuxPane] SKIP: config.enabled is false")
		return { success: false }
	}
	const startedInCmux = deps.isCmuxCompatEnvironment()
	if (!deps.isInsideTmux() && !startedInCmux) {
		log("[spawnTmuxPane] SKIP: not inside tmux or cmux-compat environment", {
			TMUX: process.env.TMUX,
			CMUX_SOCKET_PATH: process.env.CMUX_SOCKET_PATH,
		})
		return { success: false }
	}

	const paneEnvironment = await getReadyTmuxPaneEnvironment(serverAccess)
	if (!paneEnvironment) {
		log("[spawnTmuxPane] SKIP: server listener not ready", { serverOrigin })
		return { success: false }
	}

	const backend = await resolveStableTmuxBackend(deps.getTmuxPath, deps.isCmuxCompatEnvironment)
	if (!backend) {
		log("[spawnTmuxPane] SKIP: tmux backend changed or executable was unavailable")
		return { success: false }
	}
	if (backend.isCmux !== startedInCmux) {
		log("[spawnTmuxPane] SKIP: tmux backend changed while validating server readiness")
		return { success: false }
	}
	if (!deps.isInsideTmux() && !backend.isCmux) {
		log("[spawnTmuxPane] SKIP: no compatible tmux backend after server readiness")
		return { success: false }
	}
	const environmentPlan = planTmuxPaneEnvironment(paneEnvironment, backend.isCmux)
	if (!environmentPlan) {
		log("[spawnTmuxPane] SKIP: pane environment cannot be safely omitted under cmux")
		return { success: false }
	}

	log("[spawnTmuxPane] all checks passed, spawning...")

	const initialCmd = applyTmuxPaneEnvironmentToCommand(environmentPlan.isCmux
		? buildTmuxAttachCommand(serverAccess.serverUrl, sessionId, _directory)
		: buildTmuxPlaceholderCommand(description), environmentPlan)

	const args = [
		"split-window",
		splitDirection,
		"-d",
		"-P",
		"-F",
		"#{pane_id}",
		...(targetPaneId ? ["-t", targetPaneId] : []),
		...environmentPlan.args,
		initialCmd,
	]

	const result = await runTmuxCommand(backend.path, args)
	const paneId = result.output

	if (result.exitCode !== 0 || !paneId) {
		return { success: false }
	}

	const title = `omo-subagent-${description.slice(0, 20)}`
	const titleIsCmux = deps.isCmuxCompatEnvironment()
	const titleBlockReason = titleIsCmux !== backend.isCmux ||
		!isTmuxPathCompatibleWithBackend(backend.path, titleIsCmux)
		? TMUX_BACKEND_MISMATCH_ERROR
		: titleIsCmux && !planTmuxPaneEnvironment(paneEnvironment, true)
			? TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR
			: undefined
	const titleResult = titleBlockReason === undefined
		? await runTmuxCommand(backend.path, ["select-pane", "-t", paneId, "-T", title])
		: { exitCode: 1, stderr: titleBlockReason }
	if (titleResult.exitCode !== 0) {
		log("[spawnTmuxPane] WARNING: failed to set pane title", {
			paneId,
			title,
			exitCode: titleResult.exitCode,
			stderr: titleResult.stderr.trim(),
		})
	}

	return { success: true, paneId }
}

import type { TmuxConfig } from "../types"
import type { SpawnPaneResult } from "../types"
import type { TmuxServerTarget } from "../types"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"
import { getHttpServerOriginForLog, normalizeTmuxServerTarget } from "../tmux-server-target"
import type { SplitDirection } from "./environment"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import { buildTmuxEnvironmentArgs, buildTmuxPlaceholderCommand } from "./pane-command"

export type SpawnTmuxPaneDeps = {
	readonly log: (message: string, data?: unknown) => void
	readonly runTmuxCommand: typeof RunTmuxCommand
	readonly isInsideTmux: typeof isInsideTmux
	readonly isServerRunning: typeof isServerRunning
	readonly getTmuxPath: () => Promise<string | null | undefined>
}

async function resolveSpawnTmuxPaneDeps(deps?: Partial<SpawnTmuxPaneDeps>): Promise<SpawnTmuxPaneDeps> {
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
	if (!deps.isInsideTmux()) {
		log("[spawnTmuxPane] SKIP: not inside tmux", { TMUX: process.env.TMUX })
		return { success: false }
	}

	const serverRunning = await serverAccess.checkServerHealth()
	if (!serverRunning) {
		log("[spawnTmuxPane] SKIP: server listener not ready", { serverOrigin })
		return { success: false }
	}

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		log("[spawnTmuxPane] SKIP: tmux not found")
		return { success: false }
	}

	log("[spawnTmuxPane] all checks passed, spawning...")

	const placeholderCmd = buildTmuxPlaceholderCommand(description)
	const paneEnvironmentArgs = buildTmuxEnvironmentArgs(serverAccess.getPaneEnvironment())

	const args = [
		"split-window",
		splitDirection,
		"-d",
		"-P",
		"-F",
		"#{pane_id}",
		...(targetPaneId ? ["-t", targetPaneId] : []),
		...paneEnvironmentArgs,
		placeholderCmd,
	]

	const result = await runTmuxCommand(tmux, args)
	const paneId = result.output

	if (result.exitCode !== 0 || !paneId) {
		return { success: false }
	}

	const title = `omo-subagent-${description.slice(0, 20)}`
	const titleResult = await runTmuxCommand(tmux, ["select-pane", "-t", paneId, "-T", title])
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

import type { TmuxConfig } from "../types"
import type { SpawnPaneResult } from "../types"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"
import type { SplitDirection } from "./environment"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import { buildPaneAuthEnvironmentArgs, buildTmuxAttachCommand, buildTmuxPlaceholderCommand } from "./pane-command"
import { isCmuxCompatEnvironment as _isCmuxCompatEnvironment } from "../cmux-detect"

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
	serverUrl: string,
	_directory: string,
	targetPaneId?: string,
	splitDirection: SplitDirection = "-h",
	depsInput?: Partial<SpawnTmuxPaneDeps>,
): Promise<SpawnPaneResult> {
	const deps = await resolveSpawnTmuxPaneDeps(depsInput)
	const { log, runTmuxCommand } = deps

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
	if (!deps.isInsideTmux() && !deps.isCmuxCompatEnvironment()) {
		log("[spawnTmuxPane] SKIP: not inside tmux or cmux-compat environment", {
			TMUX: process.env.TMUX,
			CMUX_SOCKET_PATH: process.env.CMUX_SOCKET_PATH,
		})
		return { success: false }
	}

	const serverRunning = await deps.isServerRunning(serverUrl)
	if (!serverRunning) {
		log("[spawnTmuxPane] SKIP: server not running", { serverUrl })
		return { success: false }
	}

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		log("[spawnTmuxPane] SKIP: tmux not found")
		return { success: false }
	}

	log("[spawnTmuxPane] all checks passed, spawning...")

	const authEnvArgs = buildPaneAuthEnvironmentArgs()
	if (deps.isCmuxCompatEnvironment() && authEnvArgs.length > 0) {
		log("[spawnTmuxPane] SKIP: authenticated cmux panes are unsupported")
		return { success: false }
	}

	const initialCmd = deps.isCmuxCompatEnvironment()
		? buildTmuxAttachCommand(serverUrl, sessionId, _directory)
		: buildTmuxPlaceholderCommand(description)

	const args = [
		"split-window",
		splitDirection,
		"-d",
		"-P",
		"-F",
		"#{pane_id}",
		...(targetPaneId ? ["-t", targetPaneId] : []),
		...authEnvArgs,
		initialCmd,
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

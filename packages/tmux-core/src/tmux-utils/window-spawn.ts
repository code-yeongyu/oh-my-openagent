import type { TmuxConfig } from "../types"
import type { SpawnPaneResult } from "../types"
import { isCmuxCompatEnvironment } from "../cmux-detect"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"
import { buildPaneAuthEnvironmentArgs, buildTmuxPlaceholderCommand } from "./pane-command"

const ISOLATED_WINDOW_NAME = "omo-agents"

export type SpawnTmuxWindowDeps = {
	readonly log: (message: string, data?: unknown) => void
	readonly runTmuxCommand: typeof RunTmuxCommand
	readonly isInsideTmux: typeof isInsideTmux
	readonly isServerRunning: typeof isServerRunning
	readonly getTmuxPath: () => Promise<string | null | undefined>
}

async function resolveSpawnTmuxWindowDeps(deps?: Partial<SpawnTmuxWindowDeps>): Promise<SpawnTmuxWindowDeps> {
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

export async function spawnTmuxWindow(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
	_directory: string,
	depsInput?: Partial<SpawnTmuxWindowDeps>,
): Promise<SpawnPaneResult> {
	const deps = await resolveSpawnTmuxWindowDeps(depsInput)
	const { log, runTmuxCommand } = deps

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
	if (!deps.isInsideTmux()) {
		log("[spawnTmuxWindow] SKIP: not inside tmux", { TMUX: process.env.TMUX })
		return { success: false }
	}

	const serverRunning = await deps.isServerRunning(serverUrl)
	if (!serverRunning) {
		log("[spawnTmuxWindow] SKIP: server not running", { serverUrl })
		return { success: false }
	}

	const authEnvArgs = buildPaneAuthEnvironmentArgs()
	if (isCmuxCompatEnvironment() && authEnvArgs.length > 0) {
		log("[spawnTmuxWindow] SKIP: authenticated cmux windows are unsupported")
		return { success: false }
	}

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		log("[spawnTmuxWindow] SKIP: tmux not found")
		return { success: false }
	}

	log("[spawnTmuxWindow] all checks passed, creating isolated window...")

	const placeholderCmd = buildTmuxPlaceholderCommand(description)

	const args = [
		"new-window",
		"-d",
		"-n", ISOLATED_WINDOW_NAME,
		"-P",
		"-F", "#{pane_id}",
		...authEnvArgs,
		placeholderCmd,
	]

	const result = await runTmuxCommand(tmux, args)
	const paneId = result.output

	if (result.exitCode !== 0 || !paneId) {
		log("[spawnTmuxWindow] FAILED", { exitCode: result.exitCode, stderr: result.stderr.trim() })
		return { success: false }
	}

	const title = `omo-subagent-${description.slice(0, 20)}`
	const titleResult = await runTmuxCommand(tmux, ["select-pane", "-t", paneId, "-T", title])
	if (titleResult.exitCode !== 0) {
		log("[spawnTmuxWindow] WARNING: failed to set pane title", {
			paneId,
			title,
			exitCode: titleResult.exitCode,
			stderr: titleResult.stderr.trim(),
		})
	}

	log("[spawnTmuxWindow] SUCCESS", { paneId, windowName: ISOLATED_WINDOW_NAME })
	return { success: true, paneId }
}

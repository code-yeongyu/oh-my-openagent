import type { TmuxConfig } from "../../../config/schema"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import type { SpawnPaneResult } from "../types"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"
import type { SplitDirection } from "./environment"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import { shellSingleQuote } from "../../shell-env"

type SpawnTmuxPaneDeps = {
	log: (message: string, data?: unknown) => void
	runTmuxCommand: typeof RunTmuxCommand
	isInsideTmux: typeof isInsideTmux
	isServerRunning: typeof isServerRunning
	getTmuxPath: typeof getTmuxPath
}

async function resolveSpawnTmuxPaneDeps(deps?: Partial<SpawnTmuxPaneDeps>): Promise<SpawnTmuxPaneDeps> {
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

export async function spawnTmuxPane(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
	directory: string,
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
	if (!deps.isInsideTmux()) {
		log("[spawnTmuxPane] SKIP: not inside tmux", { TMUX: process.env.TMUX })
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

	const effectiveDirectory = directory || process.cwd()
	const opencodeCmd = `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(sessionId)} --dir ${shellSingleQuote(effectiveDirectory)}`

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

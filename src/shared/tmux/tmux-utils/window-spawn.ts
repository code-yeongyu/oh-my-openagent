import type { TmuxConfig } from "../../../config/schema"
import { getTmuxPath } from "../../../tools/interactive-bash/tmux-path-resolver"
import type { SpawnPaneResult } from "../types"
import { isInsideTmux } from "./environment"
import { isServerRunning } from "./server-health"
import { shellSingleQuote } from "../../shell-env"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"

const ISOLATED_WINDOW_NAME = "omo-agents"

type SpawnTmuxWindowDeps = {
	log: (message: string, data?: unknown) => void
	runTmuxCommand: typeof RunTmuxCommand
	isInsideTmux: typeof isInsideTmux
	isServerRunning: typeof isServerRunning
	getTmuxPath: typeof getTmuxPath
}

async function resolveSpawnTmuxWindowDeps(deps?: Partial<SpawnTmuxWindowDeps>): Promise<SpawnTmuxWindowDeps> {
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

export async function spawnTmuxWindow(
	sessionId: string,
	description: string,
	config: TmuxConfig,
	serverUrl: string,
	directory: string,
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

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		log("[spawnTmuxWindow] SKIP: tmux not found")
		return { success: false }
	}

	log("[spawnTmuxWindow] all checks passed, creating isolated window...")

	const effectiveDirectory = directory || process.cwd()
	const opencodeCmd = `opencode attach ${shellSingleQuote(serverUrl)} --session ${shellSingleQuote(sessionId)} --dir ${shellSingleQuote(effectiveDirectory)}`

	const args = [
		"new-window",
		"-d",
		"-n", ISOLATED_WINDOW_NAME,
		"-P",
		"-F", "#{pane_id}",
		opencodeCmd,
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

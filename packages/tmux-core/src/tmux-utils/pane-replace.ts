import type { TmuxConfig } from "../types"
import type { SpawnPaneResult } from "../types"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"
import { isInsideTmux } from "./environment"
import { buildTmuxPlaceholderCommand } from "./pane-command"

export type ReplaceTmuxPaneDeps = {
	readonly log: (message: string, data?: unknown) => void
	readonly runTmuxCommand: typeof RunTmuxCommand
	readonly isInsideTmux: typeof isInsideTmux
	readonly getTmuxPath: () => Promise<string | null | undefined>
}

async function resolveReplaceTmuxPaneDeps(deps?: Partial<ReplaceTmuxPaneDeps>): Promise<ReplaceTmuxPaneDeps> {
	const { runTmuxCommand } = await import("../runner")

	return {
		log: () => undefined,
		runTmuxCommand,
		isInsideTmux,
		getTmuxPath: async () => null,
		...deps,
	}
}

export async function replaceTmuxPane(
	paneId: string,
	sessionId: string,
	description: string,
	config: TmuxConfig,
	_serverUrl: string,
	_directory: string,
	depsInput?: Partial<ReplaceTmuxPaneDeps>,
): Promise<SpawnPaneResult> {
	const deps = await resolveReplaceTmuxPaneDeps(depsInput)
	const { log, runTmuxCommand } = deps

	log("[replaceTmuxPane] called", { paneId, sessionId, description })

	if (!config.enabled) {
		return { success: false }
	}
	if (!deps.isInsideTmux()) {
		return { success: false }
	}

	const tmux = await deps.getTmuxPath()
	if (!tmux) {
		return { success: false }
	}

	log("[replaceTmuxPane] sending Ctrl+C for graceful shutdown", { paneId })
	await runTmuxCommand(tmux, ["send-keys", "-t", paneId, "C-c"])

	const placeholderCmd = buildTmuxPlaceholderCommand(description)

	const result = await runTmuxCommand(tmux, ["respawn-pane", "-k", "-t", paneId, placeholderCmd])

	if (result.exitCode !== 0) {
		log("[replaceTmuxPane] FAILED", { paneId, exitCode: result.exitCode, stderr: result.stderr.trim() })
		return { success: false }
	}

	const title = `omo-subagent-${description.slice(0, 20)}`
	const titleResult = await runTmuxCommand(tmux, ["select-pane", "-t", paneId, "-T", title])
	if (titleResult.exitCode !== 0) {
		log("[replaceTmuxPane] WARNING: failed to set pane title", {
			paneId,
			title,
			exitCode: titleResult.exitCode,
			stderr: titleResult.stderr.trim(),
		})
	}

	log("[replaceTmuxPane] SUCCESS", { paneId, sessionId })
	return { success: true, paneId }
}

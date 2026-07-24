import type { TmuxConfig } from "../types"
import type { SpawnPaneResult } from "../types"
import type { TmuxServerTarget } from "../types"
import type { runTmuxCommand as RunTmuxCommand } from "../runner"
import { isCmuxCompatEnvironment, isTmuxPathCompatibleWithBackend, resolveStableTmuxBackend } from "../cmux-detect"
import { normalizeTmuxServerTarget } from "../tmux-server-target"
import { isInsideTmux } from "./environment"
import {
	buildTmuxPlaceholderCommand,
	planTmuxPaneEnvironment,
	TMUX_BACKEND_MISMATCH_ERROR,
	TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR,
} from "./pane-command"

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
	serverTarget: TmuxServerTarget,
	_directory: string,
	depsInput?: Partial<ReplaceTmuxPaneDeps>,
): Promise<SpawnPaneResult> {
	const deps = await resolveReplaceTmuxPaneDeps(depsInput)
	const { log, runTmuxCommand } = deps
	const serverAccess = normalizeTmuxServerTarget(serverTarget)

	log("[replaceTmuxPane] called", { paneId, sessionId, description })

	if (!config.enabled) {
		return { success: false }
	}
	if (!deps.isInsideTmux()) {
		return { success: false }
	}

	if (isCmuxCompatEnvironment() && !planTmuxPaneEnvironment(serverAccess.getPaneEnvironment(), true)) {
		log("[replaceTmuxPane] SKIP: pane environment cannot be safely omitted under cmux", { paneId, sessionId })
		return { success: false }
	}

	const backend = await resolveStableTmuxBackend(deps.getTmuxPath)
	if (!backend) {
		return { success: false }
	}

	if (backend.isCmux && !planTmuxPaneEnvironment(serverAccess.getPaneEnvironment(), true)) {
		log("[replaceTmuxPane] SKIP: pane environment cannot be safely omitted under cmux", { paneId, sessionId })
		return { success: false }
	}

	log("[replaceTmuxPane] sending Ctrl+C for graceful shutdown", { paneId })
	await runTmuxCommand(backend.path, ["send-keys", "-t", paneId, "C-c"])

	const currentIsCmux = isCmuxCompatEnvironment()
	if (currentIsCmux !== backend.isCmux || !isTmuxPathCompatibleWithBackend(backend.path, currentIsCmux)) {
		log(`[replaceTmuxPane] SKIP: ${TMUX_BACKEND_MISMATCH_ERROR}`, { paneId, sessionId })
		return { success: false }
	}
	const environmentPlan = planTmuxPaneEnvironment(serverAccess.getPaneEnvironment(), currentIsCmux)
	if (!environmentPlan) {
		log(`[replaceTmuxPane] SKIP: ${TMUX_PANE_ENVIRONMENT_UNSAFE_ERROR}`, { paneId, sessionId })
		return { success: false }
	}

	const placeholderCmd = buildTmuxPlaceholderCommand(description)

	const result = await runTmuxCommand(backend.path, ["respawn-pane", "-k", ...environmentPlan.args, "-t", paneId, placeholderCmd])

	if (result.exitCode !== 0) {
		log("[replaceTmuxPane] FAILED", { paneId, exitCode: result.exitCode, stderr: result.stderr.trim() })
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

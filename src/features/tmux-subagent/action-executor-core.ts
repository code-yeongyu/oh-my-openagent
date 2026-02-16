import type { TmuxConfig } from "../../config/schema"
import type { applyLayout, closeTmuxPane, enforceMainPaneWidth, replaceTmuxPane, spawnTmuxPane } from "../../shared/tmux"
import type { PaneAction, WindowState } from "./types"

export interface ActionResult {
	success: boolean
	paneId?: string
	error?: string
}

export interface ExecuteContext {
	config: TmuxConfig
	serverUrl: string
	windowState: WindowState
}

export interface ActionExecutorDeps {
	spawnTmuxPane: typeof spawnTmuxPane
	closeTmuxPane: typeof closeTmuxPane
	replaceTmuxPane: typeof replaceTmuxPane
	applyLayout: typeof applyLayout
	enforceMainPaneWidth: typeof enforceMainPaneWidth
}

async function enforceMainPane(windowState: WindowState, deps: ActionExecutorDeps): Promise<void> {
	if (!windowState.mainPane) return
	await deps.enforceMainPaneWidth(windowState.mainPane.paneId, windowState.windowWidth)
}

export async function executeActionWithDeps(
	action: PaneAction,
	ctx: ExecuteContext,
	deps: ActionExecutorDeps,
): Promise<ActionResult> {
	if (action.type === "close") {
		const success = await deps.closeTmuxPane(action.paneId)
		if (success) {
			await enforceMainPane(ctx.windowState, deps)
		}
		return { success }
	}

	if (action.type === "replace") {
		const result = await deps.replaceTmuxPane(
			action.paneId,
			action.newSessionId,
			action.description,
			ctx.config,
			ctx.serverUrl,
		)
		return {
			success: result.success,
			paneId: result.paneId,
		}
	}

	const result = await deps.spawnTmuxPane(
		action.sessionId,
		action.description,
		ctx.config,
		ctx.serverUrl,
		action.targetPaneId,
		action.splitDirection,
	)

	if (result.success) {
		await deps.applyLayout(ctx.config.layout, ctx.config.main_pane_size)
		await enforceMainPane(ctx.windowState, deps)
	}

	return {
		success: result.success,
		paneId: result.paneId,
	}
}

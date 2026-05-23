import type { TmuxConfig } from "../../config/schema"
import type { PaneAction, WindowState } from "./types"
import {
  applyLayout,
  spawnTmuxPane,
  closeTmuxPane,
  enforceMainPaneWidth,
  replaceTmuxPane,
} from "../../shared/tmux"
import { getTmuxPath } from "../../tools/interactive-bash/tmux-path-resolver"
import { queryWindowState } from "./pane-state-querier"
import { log } from "../../shared"
import type { ActionResult } from "./action-executor-core"

export type { ActionExecutorDeps, ActionResult } from "./action-executor-core"

export interface ExecuteActionsResult {
  success: boolean
  spawnedPaneId?: string
  results: Array<{ action: PaneAction; result: ActionResult }>
}

export interface ExecuteContext {
  config: TmuxConfig
  directory: string
  serverUrl: string
  windowState: WindowState
  sourcePaneId?: string
}

async function enforceMainPane(
  windowState: WindowState,
  config: TmuxConfig,
): Promise<void> {
  if (!windowState.mainPane) return
  await enforceMainPaneWidth(windowState.mainPane.paneId, windowState.windowWidth, {
    mainPaneSize: config.main_pane_size,
    mainPaneMinWidth: config.main_pane_min_width,
    agentPaneMinWidth: config.agent_pane_min_width,
  })
}

async function enforceLayoutAndMainPane(ctx: ExecuteContext): Promise<void> {
  const sourcePaneId = ctx.sourcePaneId
  if (!sourcePaneId) {
    await enforceMainPane(ctx.windowState, ctx.config)
    return
  }

  const latestState = await queryWindowState(sourcePaneId)
  if (!latestState?.mainPane) {
    await enforceMainPane(ctx.windowState, ctx.config)
    return
  }

  const tmux = await getTmuxPath()
  if (tmux) {
    await applyLayout(tmux, ctx.config.layout, ctx.config.main_pane_size)
  }

  await enforceMainPane(latestState, ctx.config)
}

/**
 * Returns true when the pane lives in the source window's tracked layout.
 *
 * The wrapper enforces the user's main-vertical layout against the source pane
 * after destructive actions. That is correct when the affected pane was part of
 * the source window (its removal changes the user's split arrangement) but
 * actively harmful when the pane lived in a separate window — closing an
 * isolated container in another window should not scramble the user's main
 * window layout. Callers route both cases through the same close action, so we
 * detect the relationship from `windowState`.
 */
function isPaneInSourceWindow(paneId: string, windowState: WindowState): boolean {
  if (windowState.mainPane?.paneId === paneId) return true
  return windowState.agentPanes.some((pane) => pane.paneId === paneId)
}

export async function executeAction(
  action: PaneAction,
  ctx: ExecuteContext
): Promise<ActionResult> {
  if (action.type === "close") {
    const closingPaneInSourceWindow = isPaneInSourceWindow(action.paneId, ctx.windowState)
    const success = await closeTmuxPane(action.paneId)
    if (success && closingPaneInSourceWindow) {
      await enforceLayoutAndMainPane(ctx)
    }
    return { success }
  }

  if (action.type === "replace") {
    const result = await replaceTmuxPane(
      action.paneId,
      action.newSessionId,
		action.description,
		ctx.config,
		ctx.serverUrl,
		ctx.directory,
	)
    if (result.success) {
      await enforceLayoutAndMainPane(ctx)
    }
    return {
      success: result.success,
      paneId: result.paneId,
    }
  }

  const result = await spawnTmuxPane(
    action.sessionId,
		action.description,
		ctx.config,
		ctx.serverUrl,
		ctx.directory,
		action.targetPaneId,
		action.splitDirection
	)

  if (result.success) {
    await enforceLayoutAndMainPane(ctx)
  }

  return {
    success: result.success,
    paneId: result.paneId,
  }
}

export async function executeActions(
  actions: PaneAction[],
  ctx: ExecuteContext
): Promise<ExecuteActionsResult> {
  const results: Array<{ action: PaneAction; result: ActionResult }> = []
  let spawnedPaneId: string | undefined

  for (const action of actions) {
    log("[action-executor] executing", { type: action.type })
    const result = await executeAction(action, ctx)
    results.push({ action, result })

    if (!result.success) {
      log("[action-executor] action failed", { type: action.type, error: result.error })
      return { success: false, results }
    }

    if ((action.type === "spawn" || action.type === "replace") && result.paneId) {
      spawnedPaneId = result.paneId
    }
  }

  return { success: true, spawnedPaneId, results }
}

import type { TmuxConfig } from "../../config/schema"
import type { PaneAction, WindowState } from "./types"
import { spawnTmuxPane, closeTmuxPane, enforceMainPaneWidth, replaceTmuxPane } from "../../shared/tmux"
import { log } from "../../shared"

export interface ActionResult {
  success: boolean
  paneId?: string
  error?: string
}

export interface ExecuteActionsResult {
  success: boolean
  spawnedPaneId?: string
  results: Array<{ action: PaneAction; result: ActionResult }>
}

export interface ExecuteContext {
  config: TmuxConfig
  serverUrl: string
  windowState: WindowState
}

async function enforceMainPane(windowState: WindowState): Promise<void> {
  if (!windowState.mainPane) return
  await enforceMainPaneWidth(windowState.mainPane.paneId, windowState.windowWidth)
}

export async function executeAction(
  action: PaneAction,
  ctx: ExecuteContext
): Promise<ActionResult> {
  if (action.type === "close") {
    const success = await closeTmuxPane(action.paneId)
    if (success) {
      await enforceMainPane(ctx.windowState)
    }
    return { success }
  }

  if (action.type === "replace") {
    const result = await replaceTmuxPane(
      action.paneId,
      action.newSessionId,
      action.description,
      ctx.config,
      ctx.serverUrl
    )
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
    action.targetPaneId,
    action.splitDirection
  )

  if (result.success) {
    await enforceMainPane(ctx.windowState)
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

import type { TmuxConfig } from "../../config/schema"
import type { CmuxConfig } from "../../config/schema/cmux"
import type { PaneAction, WindowState } from "./types"
import {
  spawnPane,
  closePane,
  applyLayout as applyMultiplexerLayout,
  enforceMainPaneWidth as enforceMultiplexerMainPaneWidth,
  detectMultiplexer,
} from "../../shared/multiplexer"
import { queryWindowState } from "./pane-state-querier"
import { log } from "../../shared"
import type {
  ActionResult,
  ActionExecutorDeps,
} from "./action-executor-core"

export type { ActionExecutorDeps, ActionResult } from "./action-executor-core"

export interface ExecuteActionsResult {
  success: boolean
  spawnedPaneId?: string
  results: Array<{ action: PaneAction; result: ActionResult }>
}

export interface ExecuteContext {
  tmuxConfig: TmuxConfig
  cmuxConfig: CmuxConfig
  serverUrl: string
  windowState: WindowState
  sourcePaneId?: string
}

async function enforceMainPane(
  windowState: WindowState,
  ctx: ExecuteContext,
): Promise<void> {
  if (!windowState.mainPane) return
  await enforceMultiplexerMainPaneWidth(
    windowState.mainPane.paneId,
    windowState.windowWidth,
    ctx.tmuxConfig,
    ctx.cmuxConfig
  )
}

async function enforceLayoutAndMainPane(ctx: ExecuteContext): Promise<void> {
  const sourcePaneId = ctx.sourcePaneId
  if (!sourcePaneId) {
    await enforceMainPane(ctx.windowState, ctx)
    return
  }

  const latestState = await queryWindowState(sourcePaneId)
  if (!latestState?.mainPane) {
    await enforceMainPane(ctx.windowState, ctx)
    return
  }

  const mux = detectMultiplexer()
  const layout = mux === "cmux" ? ctx.cmuxConfig.layout : ctx.tmuxConfig.layout
  const mainPaneSize = mux === "cmux" ? ctx.cmuxConfig.main_pane_size : ctx.tmuxConfig.main_pane_size
  
  await applyMultiplexerLayout(layout, mainPaneSize, ctx.tmuxConfig, ctx.cmuxConfig)
  await enforceMainPane(latestState, ctx)
}

export async function executeAction(
  action: PaneAction,
  ctx: ExecuteContext
): Promise<ActionResult> {
  if (action.type === "close") {
    const success = await closePane(action.paneId, ctx.tmuxConfig, ctx.cmuxConfig)
    if (success) {
      await enforceLayoutAndMainPane(ctx)
    }
    return { success }
  }

  if (action.type === "replace") {
    const result = await spawnPane(
      action.newSessionId,
      action.description,
      ctx.tmuxConfig,
      ctx.cmuxConfig,
      ctx.serverUrl,
      action.paneId,
      "-h"
    )
    if (result.success) {
      await enforceLayoutAndMainPane(ctx)
    }
    return {
      success: result.success,
      paneId: result.paneId,
    }
  }

  const result = await spawnPane(
    action.sessionId,
    action.description,
    ctx.tmuxConfig,
    ctx.cmuxConfig,
    ctx.serverUrl,
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

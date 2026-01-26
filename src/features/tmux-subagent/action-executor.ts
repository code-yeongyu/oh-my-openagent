import type { TmuxConfig } from "../../config/schema"
import type { PaneAction } from "./types"
import { spawnTmuxPane, closeTmuxPane } from "../../shared/tmux"
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

export async function executeAction(
  action: PaneAction,
  config: TmuxConfig,
  serverUrl: string
): Promise<ActionResult> {
  if (action.type === "close") {
    const success = await closeTmuxPane(action.paneId)
    return { success }
  }

  const result = await spawnTmuxPane(
    action.sessionId,
    action.description,
    config,
    serverUrl,
    action.targetPaneId
  )

  return {
    success: result.success,
    paneId: result.paneId,
  }
}

export async function executeActions(
  actions: PaneAction[],
  config: TmuxConfig,
  serverUrl: string
): Promise<ExecuteActionsResult> {
  const results: Array<{ action: PaneAction; result: ActionResult }> = []
  let spawnedPaneId: string | undefined

  for (const action of actions) {
    log("[action-executor] executing", { type: action.type })
    const result = await executeAction(action, config, serverUrl)
    results.push({ action, result })

    if (!result.success) {
      log("[action-executor] action failed", { type: action.type, error: result.error })
      return { success: false, results }
    }

    if (action.type === "spawn" && result.paneId) {
      spawnedPaneId = result.paneId
    }
  }

  return { success: true, spawnedPaneId, results }
}

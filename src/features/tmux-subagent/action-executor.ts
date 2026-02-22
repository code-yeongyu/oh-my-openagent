import type { PaneAction } from "./types"
import { applyLayout, spawnTmuxPane, closeTmuxPane, enforceMainPaneWidth, replaceTmuxPane } from "../../shared/tmux"
import { log } from "../../shared"
import type {
  ActionExecutorDeps,
  ActionResult,
  ExecuteContext,
} from "./action-executor-core"
import { executeActionWithDeps } from "./action-executor-core"

export type { ActionExecutorDeps, ActionResult, ExecuteContext } from "./action-executor-core"

export interface ExecuteActionsResult {
  success: boolean
  spawnedPaneId?: string
  results: Array<{ action: PaneAction; result: ActionResult }>
}

const DEFAULT_DEPS: ActionExecutorDeps = {
  spawnTmuxPane,
  closeTmuxPane,
  replaceTmuxPane,
  applyLayout,
  enforceMainPaneWidth,
}

export async function executeAction(
  action: PaneAction,
  ctx: ExecuteContext
): Promise<ActionResult> {
  return executeActionWithDeps(action, ctx, DEFAULT_DEPS)
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

import type { AvailableSkill } from "./agents/dynamic-agent-prompt-builder"
import type { HookName, OhMyOpenCodeConfig } from "./config"
import type { LoadedSkill } from "./features/opencode-skill-loader/types"
import type { BackgroundManager } from "./features/background-agent"
import type { PluginContext } from "./plugin/types"
import type { ModelCacheState } from "./plugin-state"

import { createCoreHooks } from "./plugin/hooks/create-core-hooks"
import { createContinuationHooks } from "./plugin/hooks/create-continuation-hooks"
import { createSkillHooks } from "./plugin/hooks/create-skill-hooks"
import { normalizeSDKResponse } from "./shared"

export type CreatedHooks = ReturnType<typeof createHooks>

export function createHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  modelCacheState: ModelCacheState
  backgroundManager: BackgroundManager
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  mergedSkills: LoadedSkill[]
  availableSkills: AvailableSkill[]
}) {
  const {
    ctx,
    pluginConfig,
    modelCacheState,
    backgroundManager,
    isHookEnabled,
    safeHookEnabled,
    mergedSkills,
    availableSkills,
  } = args

  const core = createCoreHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    isHookEnabled,
    safeHookEnabled,
  })

  const continuation = createContinuationHooks({
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    backgroundManager,
    sessionRecovery: core.sessionRecovery,
  })

  core.ralphLoop?.setOnLoopCompleted(async (sessionID: string) => {
    continuation.stopContinuationGuard?.stop(sessionID)

    const tasks = backgroundManager.getAllDescendantTasks(sessionID)
    const runningOrPendingTasks = tasks.filter((task) => task.status === "running" || task.status === "pending")
    await Promise.all(
      runningOrPendingTasks.map((task) =>
        backgroundManager.cancelTask(task.id, {
          source: "ralph-loop.completed",
          reason: "Ralph loop completed",
          skipNotification: true,
        }).catch(() => false)
      )
    )
  })

  core.ralphLoop?.setShouldDeferIteration(async (sessionID: string) => {
    const hasRunningDescendantTasks = backgroundManager
      .getAllDescendantTasks(sessionID)
      .some((task) => task.status === "running" || task.status === "pending")

    if (hasRunningDescendantTasks) {
      return true
    }

    try {
      const response = await ctx.client.session.todo({ path: { id: sessionID } })
      const todos = normalizeSDKResponse(response, [] as Array<{ status?: string }>, {
        preferResponseOnMissingData: true,
      })

      if (!todos || todos.length === 0) {
        return false
      }

      return todos.some(
        (todo) => todo.status !== "completed" && todo.status !== "cancelled"
      )
    } catch {
      return true
    }
  })

  const skill = createSkillHooks({
    ctx,
    isHookEnabled,
    safeHookEnabled,
    mergedSkills,
    availableSkills,
  })

  return {
    ...core,
    ...continuation,
    ...skill,
  }
}

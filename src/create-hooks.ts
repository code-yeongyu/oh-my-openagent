import type { AvailableSkill } from "./agents/dynamic-agent-prompt-builder"
import type { HookName, OhMyOpenCodeConfig } from "./config"
import type { LoadedSkill } from "./features/opencode-skill-loader/types"
import type { BackgroundManager } from "./features/background-agent"
import type { PluginContext } from "./plugin/types"
import type { ModelCacheState } from "./plugin-state"

import { createCoreHooks, type CoreHooks } from "./plugin/hooks/create-core-hooks"
import { createContinuationHooks, type ContinuationHooks } from "./plugin/hooks/create-continuation-hooks"
import { createSkillHooks, type SkillHooks } from "./plugin/hooks/create-skill-hooks"

export type CreatedHooks = CoreHooks & ContinuationHooks & SkillHooks & {
  disposeHooks: () => void
}

export function createHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  modelCacheState: ModelCacheState
  backgroundManager: BackgroundManager
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  mergedSkills: LoadedSkill[]
  availableSkills: AvailableSkill[]
}): CreatedHooks {
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

  const skill = createSkillHooks({
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    mergedSkills,
    availableSkills,
  })

  return {
    ...core,
    ...continuation,
    ...skill,
    disposeHooks: (): void => {
      core.claudeCodeHooks?.dispose?.()
      core.commentChecker?.dispose?.()
      core.runtimeFallback?.dispose?.()
      continuation.todoContinuationEnforcer?.dispose?.()
      skill.autoSlashCommand?.dispose?.()
      core.anthropicContextWindowLimitRecovery?.dispose?.()
    },
  }
}

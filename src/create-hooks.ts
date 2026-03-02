import type { AvailableSkill } from "./agents/dynamic-agent-prompt-builder"
import type { HookName, OhMyOpenCodeConfig } from "./config"
import type { LoadedSkill } from "./features/opencode-skill-loader/types"
import type { BackgroundManager } from "./features/background-agent"
import type { PluginContext } from "./plugin/types"
import type { ModelCacheState } from "./plugin-state"

import { createCoreHooks } from "./plugin/hooks/create-core-hooks"
import { createContinuationHooks } from "./plugin/hooks/create-continuation-hooks"
import { createSkillHooks } from "./plugin/hooks/create-skill-hooks"
import { HookCadenceTracker } from "./plugin/hook-cadence-tracker"

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

  // Initialize cadence tracker with config
  const cadenceTracker = new HookCadenceTracker(pluginConfig.hook_cadence)

  const core = createCoreHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    isHookEnabled,
    safeHookEnabled,
    cadenceTracker,
  })

  const continuation = createContinuationHooks({
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    backgroundManager,
    sessionRecovery: core.sessionRecovery,
    cadenceTracker,
  })

  const skill = createSkillHooks({
    ctx,
    isHookEnabled,
    safeHookEnabled,
    mergedSkills,
    availableSkills,
    cadenceTracker,
  })

  return {
    ...core,
    ...continuation,
    ...skill,
  }
}

import type { AvailableSkill } from "./agents/dynamic-agent-prompt-builder"
import type { HookName, OhMyOpenCodeConfig } from "./config"
import type { LoadedSkill } from "./features/opencode-skill-loader/types"
import type { BackgroundManager } from "./features/background-agent"
import type { PluginContext } from "./plugin/types"
import type { ModelCacheState } from "./plugin-state"

import { createCoreHooks } from "./plugin/hooks/create-core-hooks"
import { createContinuationHooks } from "./plugin/hooks/create-continuation-hooks"
import { createSkillHooks } from "./plugin/hooks/create-skill-hooks"

export type CreatedHooks = ReturnType<typeof createHooks>

type DisposableHook = { dispose?: () => void } | null | undefined

export type DisposableCreatedHooks = {
  runtimeFallback?: DisposableHook
  todoContinuationEnforcer?: DisposableHook
  autoSlashCommand?: DisposableHook
}

export function disposeCreatedHooks(hooks: DisposableCreatedHooks): void {
  hooks.runtimeFallback?.dispose?.()
  hooks.todoContinuationEnforcer?.dispose?.()
  hooks.autoSlashCommand?.dispose?.()
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

  const skill = createSkillHooks({
    ctx,
    pluginConfig,
    isHookEnabled,
    safeHookEnabled,
    mergedSkills,
    availableSkills,
  })

  const hooks = {
    ...core,
    ...continuation,
    ...skill,
  }

  return {
    ...hooks,
    disposeHooks: (): void => {
      disposeCreatedHooks(hooks)
    },
  }
}

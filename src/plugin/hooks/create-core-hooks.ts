import type { HookName, OhMyOpenCodeConfig } from "../../config"
import type { PluginContext } from "../types"
import type { ModelCacheState } from "../../plugin-state"
import type { HookCadenceTracker } from "../hook-cadence-tracker"

import { createSessionHooks } from "./create-session-hooks"
import { createToolGuardHooks } from "./create-tool-guard-hooks"
import { createTransformHooks } from "./create-transform-hooks"

export function createCoreHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  modelCacheState: ModelCacheState
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
  cadenceTracker: HookCadenceTracker
}) {
  const { ctx, pluginConfig, modelCacheState, isHookEnabled, safeHookEnabled, cadenceTracker } = args

  const session = createSessionHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    isHookEnabled,
    safeHookEnabled,
    cadenceTracker,
  })

  const tool = createToolGuardHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    isHookEnabled,
    safeHookEnabled,
    cadenceTracker,
  })

  const transform = createTransformHooks({
    ctx,
    pluginConfig,
    isHookEnabled: (name) => isHookEnabled(name as HookName),
    safeHookEnabled,
  })

  return {
    ...session,
    ...tool,
    ...transform,
  }
}

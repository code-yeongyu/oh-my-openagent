import type { HookName, OhMyOpenCodeConfig } from "../../config"
import type { ModelFallbackControllerAccessor } from "../../hooks/model-fallback"
import type { PluginContext } from "../types"
import type { ModelCacheState } from "../../plugin-state"

import { createSessionHooks } from "./create-session-hooks"
import { createToolGuardHooks } from "./create-tool-guard-hooks"
import { createTransformHooks } from "./create-transform-hooks"

export function createCoreHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  modelCacheState: ModelCacheState
  modelFallbackControllerAccessor?: ModelFallbackControllerAccessor
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
}) {
  const { ctx, pluginConfig, modelCacheState, modelFallbackControllerAccessor, isHookEnabled, safeHookEnabled } = args

  const session = createSessionHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    modelFallbackControllerAccessor,
    isHookEnabled,
    safeHookEnabled,
  })

  const tool = createToolGuardHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    isHookEnabled,
    safeHookEnabled,
  })

  const transform = createTransformHooks({
    ctx,
    pluginConfig,
    isHookEnabled: (name) => isHookEnabled(name as HookName),
    safeHookEnabled,
    ralphLoop: session.ralphLoop,
  })

  return {
    ...session,
    ...tool,
    ...transform,
  }
}

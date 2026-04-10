import type { HookName, OhMyOpenCodeConfig } from "../../config"
import type { PluginContext } from "../types"
import type { ModelCacheState } from "../../plugin-state"

import { createSessionHooks, type SessionHooks } from "./create-session-hooks"
import { createToolGuardHooks, type ToolGuardHooks } from "./create-tool-guard-hooks"
import { createTransformHooks, type TransformHooks } from "./create-transform-hooks"

export type CoreHooks = SessionHooks & ToolGuardHooks & TransformHooks

export function createCoreHooks(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  modelCacheState: ModelCacheState
  isHookEnabled: (hookName: HookName) => boolean
  safeHookEnabled: boolean
}) {
  const { ctx, pluginConfig, modelCacheState, isHookEnabled, safeHookEnabled } = args

  const session = createSessionHooks({
    ctx,
    pluginConfig,
    modelCacheState,
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
  })

  return {
    ...session,
    ...tool,
    ...transform,
  }
}

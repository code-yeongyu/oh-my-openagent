import type { Plugin } from "@opencode-ai/plugin"
import type { V2Cleanup, V2PluginContext } from "./context-types"
import { createPluginInput } from "./create-plugin-input"

export type V2SetupDeps = {
  readonly serverPlugin: Plugin
}

/**
 * OpenCode 2.x entry: runs the V1 plugin body once against a V1-shaped input derived from the V2
 * context, then returns the cleanup V2 calls when the plugin unloads.
 */
export function createV2Setup(deps: V2SetupDeps): (context: V2PluginContext) => Promise<V2Cleanup> {
  return async (context) => {
    const input = createPluginInput(context)
    const hooks = await deps.serverPlugin(input, { ...context.options })
    let disposed = false
    return async () => {
      if (disposed) return
      disposed = true
      await hooks.dispose?.()
    }
  }
}

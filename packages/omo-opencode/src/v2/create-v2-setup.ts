import type { Hooks, Plugin } from "@opencode-ai/plugin"
import type { V2Cleanup, V2PluginContext } from "./context-types"
import { createPluginInput } from "./create-plugin-input"
import { startEventBridge } from "./event-bridge"
import { installHooks } from "./install-hooks"
import { createSessionTracker } from "./session-tracker"
import { log } from "../shared/logger"

export type V2SetupDeps = {
  readonly serverPlugin: Plugin
  readonly warn?: (message: string) => void
}

const warnOnce = (): ((message: string) => void) => {
  const seen = new Set<string>()
  return (message) => {
    if (seen.has(message)) return
    seen.add(message)
    log(`[v2] ${message}`)
  }
}

/**
 * OpenCode 2.x entry: runs the V1 plugin body once against a V1-shaped input derived from the V2
 * context, installs what its hooks define onto the 2.x domains, and returns the cleanup V2 calls
 * when the plugin unloads.
 */
export function createV2Setup(deps: V2SetupDeps): (context: V2PluginContext) => Promise<V2Cleanup> {
  const warn = deps.warn ?? warnOnce()
  return async (context) => {
    const tracker = createSessionTracker()
    const bridge = startEventBridge(context, { tracker, warn })
    let hooks: Hooks
    let uninstall: () => Promise<void>
    try {
      const input = createPluginInput(context, { tracker, warn })
      hooks = await deps.serverPlugin(input, { ...context.options })
      uninstall = await installHooks(context, hooks, { warn })
    } catch (error) {
      bridge.stop()
      throw error
    }
    bridge.setHandler(hooks.event)
    let disposed = false
    return async () => {
      if (disposed) return
      disposed = true
      bridge.stop()
      await uninstall()
      await hooks.dispose?.()
    }
  }
}

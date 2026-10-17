import type { PluginModule } from "@opencode-ai/plugin"
import { createPluginModule } from "./testing/create-plugin-module"
import { defineV2Plugin } from "./plugin/v2/v2-plugin"
import type { V2Plugin } from "./plugin/v2/types"

/**
 * Dual-host plugin module.
 *
 * - OpenCode V1 (`opencode`) loads the default export as a `PluginModule`
 *   and calls `.server(input)`.
 * - OpenCode V2 (`opencode2`, beta) loads the same default export and calls
 *   `.setup(ctx)`; the extra `server` key is ignored by the V2 loader
 *   (verified live: beta-18721, see .omo/evidence/20260831-opencode-v2-dual-host/).
 * - `Plugin.define` is identity at runtime, so the object literal satisfies
 *   the V2 `Plugin` contract without importing the beta plugin package.
 */

const pluginModule: PluginModule = createPluginModule()

const v2Plugin: V2Plugin = defineV2Plugin({
  id: pluginModule.id ?? "oh-my-openagent",
  startV1ServerPlugin: (input) => pluginModule.server(input as never),
})

const dualHostPlugin = {
  id: pluginModule.id ?? "oh-my-openagent",
  server: pluginModule.server,
  setup: v2Plugin.setup,
}

export const omoPlugin = pluginModule.server
export const omoPluginV2 = v2Plugin

export default dualHostPlugin

export type {
  AgentName,
  AgentOverrideConfig,
  AgentOverrides,
  BuiltinCommandName,
  HookName,
  McpName,
  OhMyOpenCodeConfig,
} from "./config"

export type { ConfigLoadError } from "./shared/config-errors"

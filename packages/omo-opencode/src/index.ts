import type { PluginModule } from "@opencode-ai/plugin"
import { createPluginModule } from "./testing/create-plugin-module"

const pluginModule: PluginModule = createPluginModule()

export const omoPlugin = pluginModule.server

export default pluginModule

/**
 * Additive dual-host entry (code-yeongyu/oh-my-openagent#9389): V2 hosts
 * resolve `setup` from this export; V1 hosts keep resolving the default
 * PluginModule above. V1 behaviour is unchanged.
 */
export { omoV2Plugin, default as omoV2 } from "./v2/index"

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

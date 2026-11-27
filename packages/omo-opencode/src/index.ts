import type { PluginModule } from "@opencode-ai/plugin"
import { opencodeV2Server } from "./opencode-v2/server-entry"
import { createPluginModule } from "./testing/create-plugin-module"

const pluginModule: PluginModule = createPluginModule()

export const omoPlugin = pluginModule.server

export default { ...pluginModule, setup: opencodeV2Server.setup }

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

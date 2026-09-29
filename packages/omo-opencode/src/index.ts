import type { PluginModule } from "@opencode-ai/plugin"
import { Plugin } from "@opencode/plugin"
import { createPluginModule } from "./testing/create-plugin-module"
import { setupV2 } from "./v2-setup"

const pluginModule: PluginModule = createPluginModule()

export const omoPlugin = pluginModule.server

export default {
  ...Plugin.define({
    id: "oh-my-openagent",
    setup: setupV2,
  }),
  server: pluginModule.server,
}

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

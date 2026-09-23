import type { PluginModule } from "@opencode-ai/plugin"
import { Plugin } from "@opencode/plugin"
import { createPluginModule } from "./testing/create-plugin-module"
import { createV2Setup } from "./v2-setup"

const pluginModule: PluginModule = createPluginModule()

export const omoPlugin = pluginModule.server

const v2Definition = Plugin.define({
  id: "oh-my-openagent",
  setup: createV2Setup(),
})

export default {
  ...v2Definition,
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

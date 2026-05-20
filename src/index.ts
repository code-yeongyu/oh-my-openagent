import type { PluginModule } from "@opencode-ai/plugin"
import { createPluginModule } from "./testing/create-plugin-module"

const pluginModule: PluginModule = createPluginModule()

export default pluginModule

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

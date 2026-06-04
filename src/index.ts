import type { PluginModule } from "@opencode-ai/plugin"
import { createPluginModule } from "./testing/create-plugin-module"
import { PROCESS_LISTENERS_CAP_DEFAULT, raiseProcessListenersCap } from "./shared/raise-process-listeners-cap"

// Quiet the MaxListenersExceededWarning fired when plugin/cleanup listeners
// accumulate past Node's default cap of 10 (#4334).
raiseProcessListenersCap(PROCESS_LISTENERS_CAP_DEFAULT)

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

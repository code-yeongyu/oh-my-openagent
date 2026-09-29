import { Plugin } from "@opencode/plugin"
import type { PluginModule } from "@opencode-ai/plugin"

import { createPluginModule } from "./testing/create-plugin-module"
import { setupOpenCodeV2 } from "./v2/host"

const pluginModule: PluginModule = createPluginModule()

export const omoPlugin = pluginModule.server

export default {
  ...Plugin.define({
    id: "oh-my-openagent",
    setup(ctx) {
      return setupOpenCodeV2(ctx, { server: omoPlugin as never })
    },
  }),
  server: omoPlugin,
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

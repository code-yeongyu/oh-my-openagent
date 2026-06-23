import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"
import { createPluginModule } from "./testing/create-plugin-module"
import { loadPluginConfig } from "./plugin-config"
import { log } from "./shared/logger"
import { installToastTap, uninstallToastTap } from "./shared/toast-tap"
import { McpPersistencePoller } from "./features/mcp-persistence"
import {
  __setCamoufoxDriverForTest,
  __setCurlCffiDriverForTest,
} from "./features/probe-lab/replay-engine-dispatcher"
import { createCamoufoxDriver } from "./features/probe-lab/replay-engine-camoufox-driver"
import { createCurlCffiDriver } from "./features/probe-lab/replay-engine-curl-cffi-driver"

const baseModule = createPluginModule()

const idmServer: Plugin = async (input, options): Promise<Hooks> => {
  const hooks = await baseModule.server(input, options)

  installToastTap(input.client as Parameters<typeof installToastTap>[0])

  const pluginConfig = loadPluginConfig(input.directory, input)

  if (pluginConfig.probe_lab?.force_drivers_register) {
    try {
      __setCurlCffiDriverForTest(createCurlCffiDriver())
      __setCamoufoxDriverForTest(createCamoufoxDriver())
      log("[oh-my-openagent] probe-lab drivers force-registered via config")
    } catch (error) {
      log("[oh-my-openagent] probe-lab force-register failed", {
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const mcpPersistenceCfg = pluginConfig.mcp_persistence
  const mcpPersistencePoller =
    mcpPersistenceCfg?.enabled === false
      ? undefined
      : new McpPersistencePoller({
          client: input.client as unknown as ConstructorParameters<
            typeof McpPersistencePoller
          >[0]["client"],
          directory: input.directory,
          intervalMs: mcpPersistenceCfg?.poll_interval_ms,
        })
  mcpPersistencePoller?.start()

  const baseDispose = hooks.dispose
  return {
    ...hooks,
    dispose: async (): Promise<void> => {
      mcpPersistencePoller?.stop()
      try {
        uninstallToastTap(input.client as Parameters<typeof uninstallToastTap>[0])
      } catch (error) {
        log("[oh-my-openagent] uninstallToastTap failed", {
          message: error instanceof Error ? error.message : String(error),
        })
      }
      await baseDispose?.()
    },
  }
}

const pluginModule: PluginModule = {
  ...baseModule,
  server: idmServer,
}

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

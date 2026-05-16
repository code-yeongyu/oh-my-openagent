import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"
import type { HookName } from "../config"
import { initConfigContext } from "../cli/config-manager/config-context"

import { createHooks } from "../create-hooks"
import { createManagers } from "../create-managers"
import { createRuntimeTmuxConfig, isTmuxIntegrationEnabled } from "../create-runtime-tmux-config"
import { createTools } from "../create-tools"
import { initializeOpenClaw } from "../openclaw"
import { createPluginInterface } from "../plugin-interface"
import { loadPluginConfig } from "../plugin-config"
import { createModelCacheState } from "../plugin-state"
import {
  createCompactionAutocontinueHandler,
  createSessionCompactingHandler,
  type CompactionAutocontinueHook,
} from "../plugin/session-compacting"
import { installAgentSortShim, setAgentSortOrder } from "../shared/agent-sort-shim"
import { detectExternalSkillPlugin, getSkillPluginConflictWarning } from "../shared/external-plugin-detector"
import { createFirstMessageVariantGate } from "../shared/first-message-variant"
import { log } from "../shared/logger"
import { logLegacyPluginStartupWarning } from "../shared/log-legacy-plugin-startup-warning"
import { migrateLegacyWorkspaceDirectory } from "../shared/legacy-workspace-migration"
import { injectServerAuthIntoClient } from "../shared/opencode-server-auth"
import { startBackgroundCheck as startTmuxCheck } from "../tools/interactive-bash"

type HooksWithCompactionAutocontinue = Hooks & {
  "experimental.compaction.autocontinue"?: CompactionAutocontinueHook
}

export type PluginModuleDeps = {
  initConfigContext: typeof initConfigContext
  installAgentSortShim: typeof installAgentSortShim
  setAgentSortOrder: typeof setAgentSortOrder
  log: typeof log
  logLegacyPluginStartupWarning: typeof logLegacyPluginStartupWarning
  migrateLegacyWorkspaceDirectory: typeof migrateLegacyWorkspaceDirectory
  detectExternalSkillPlugin: typeof detectExternalSkillPlugin
  getSkillPluginConflictWarning: typeof getSkillPluginConflictWarning
  injectServerAuthIntoClient: typeof injectServerAuthIntoClient
  loadPluginConfig: typeof loadPluginConfig
  initializeOpenClaw: typeof initializeOpenClaw
  isTmuxIntegrationEnabled: typeof isTmuxIntegrationEnabled
  startTmuxCheck: typeof startTmuxCheck
  createFirstMessageVariantGate: typeof createFirstMessageVariantGate
  createRuntimeTmuxConfig: typeof createRuntimeTmuxConfig
  createModelCacheState: typeof createModelCacheState
  createManagers: typeof createManagers
  createTools: typeof createTools
  createHooks: typeof createHooks
  createPluginInterface: typeof createPluginInterface
}

const defaultPluginModuleDeps: PluginModuleDeps = {
  initConfigContext,
  installAgentSortShim,
  setAgentSortOrder,
  log,
  logLegacyPluginStartupWarning,
  migrateLegacyWorkspaceDirectory,
  detectExternalSkillPlugin,
  getSkillPluginConflictWarning,
  injectServerAuthIntoClient,
  loadPluginConfig,
  initializeOpenClaw,
  isTmuxIntegrationEnabled,
  startTmuxCheck,
  createFirstMessageVariantGate,
  createRuntimeTmuxConfig,
  createModelCacheState,
  createManagers,
  createTools,
  createHooks,
  createPluginInterface,
}

export function createPluginModule(overrides: Partial<PluginModuleDeps> = {}): PluginModule {
  const deps = { ...defaultPluginModuleDeps, ...overrides }
  const serverPlugin: Plugin = async (input, _options): Promise<Hooks> => {
    deps.installAgentSortShim()
    deps.initConfigContext("opencode", null)
    deps.log("[oh-my-openagent] ENTRY - plugin loading", {
      directory: input.directory,
    })
    deps.logLegacyPluginStartupWarning()
    deps.migrateLegacyWorkspaceDirectory(input.directory)

    const skillPluginCheck = deps.detectExternalSkillPlugin(input.directory)
    if (skillPluginCheck.detected && skillPluginCheck.pluginName) {
      console.warn(deps.getSkillPluginConflictWarning(skillPluginCheck.pluginName))
    }

    deps.injectServerAuthIntoClient(input.client)

    const pluginConfig = deps.loadPluginConfig(input.directory, input)
    deps.setAgentSortOrder(pluginConfig.agent_order)

    if (pluginConfig.openclaw) {
      await deps.initializeOpenClaw(pluginConfig.openclaw)
    }
    if (pluginConfig.team_mode?.enabled) {
      const teamModeConfig = pluginConfig.team_mode
      try {
        const { ensureBaseDirs, resolveBaseDir } = await import("../features/team-mode/team-registry/paths")
        const { checkTeamModeDependencies } = await import("../features/team-mode/deps")
        await checkTeamModeDependencies(teamModeConfig)
        await ensureBaseDirs(resolveBaseDir(teamModeConfig))
        if (pluginConfig.disabled_skills?.includes("team-mode")) {
          console.warn(
            "[team-mode] enabled=true but team-mode skill is disabled; skill docs hidden but tools still registered (D-29)",
          )
        }
      } catch (err) {
        console.warn("[team-mode] init failed:", err)
      }
    }
    const tmuxIntegrationEnabled = deps.isTmuxIntegrationEnabled(pluginConfig)
    if (tmuxIntegrationEnabled) {
      deps.startTmuxCheck()
    }
    const disabledHooks = new Set(pluginConfig.disabled_hooks ?? [])

    const isHookEnabled = (hookName: HookName): boolean => !disabledHooks.has(hookName)
    const safeHookEnabled = pluginConfig.experimental?.safe_hook_creation ?? true

    const firstMessageVariantGate = deps.createFirstMessageVariantGate()

    const tmuxConfig = deps.createRuntimeTmuxConfig(pluginConfig)

    const modelCacheState = deps.createModelCacheState()

    const managers = deps.createManagers({
      ctx: input,
      pluginConfig,
      tmuxConfig,
      modelCacheState,
      backgroundNotificationHookEnabled: isHookEnabled("background-notification"),
    })

    const toolsResult = await deps.createTools({
      ctx: input,
      pluginConfig,
      managers,
    })

    const hooks = deps.createHooks({
      ctx: input,
      pluginConfig,
      modelCacheState,
      backgroundManager: managers.backgroundManager,
      modelFallbackControllerAccessor: managers.modelFallbackControllerAccessor,
      isHookEnabled,
      safeHookEnabled,
      mergedSkills: toolsResult.mergedSkills,
      availableSkills: toolsResult.availableSkills,
    })

    const pluginInterface = deps.createPluginInterface({
      ctx: input,
      pluginConfig,
      firstMessageVariantGate,
      managers,
      hooks,
      tools: toolsResult.filteredTools,
    })

    const pluginHooks: HooksWithCompactionAutocontinue = {
      ...pluginInterface,

      "experimental.session.compacting": createSessionCompactingHandler(hooks),

      "experimental.compaction.autocontinue": createCompactionAutocontinueHandler(hooks),
    }

    return pluginHooks
  }

  return {
    id: "oh-my-openagent",
    server: serverPlugin,
  }
}

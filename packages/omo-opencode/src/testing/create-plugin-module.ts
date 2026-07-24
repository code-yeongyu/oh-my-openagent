import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"
import type { HookName } from "../config"
import { initConfigContext } from "../cli/config-manager/config-context"
import { ensureTuiPluginEntry } from "../cli/config-manager/add-tui-plugin-to-tui-config"

import { createHooks } from "../create-hooks"
import { createManagers } from "../create-managers"
import { createRuntimeTmuxConfig, isTmuxIntegrationEnabled } from "../create-runtime-tmux-config"
import { createTools } from "../create-tools"
import { createRuntimeSkillSourceServer, selectRuntimeSecuritySkills } from "../features/opencode-runtime-skills"
import { initializeOpenClaw, stopReplyListener } from "../openclaw"
import { createPluginDispose } from "../plugin-dispose"
import { createPluginInterface } from "../plugin-interface"
import { loadPluginConfig } from "../plugin-config"
import { createModelCacheState } from "../plugin-state"
import {
  createCompactionAutocontinueHandler,
  createSessionCompactingHandler,
  type CompactionAutocontinueHook,
} from "../plugin/session-compacting"
import { installAgentSortShim, setAgentSortOrder } from "../shared/agent-sort-shim"
import {
  detectDuplicateOmoPlugin,
  detectExternalSkillPlugin,
  getDuplicateOmoPluginWarning,
  getSkillPluginConflictWarning,
} from "../shared/external-plugin-detector"
import { createFirstMessageVariantGate } from "../shared/first-message-variant"
import { initI18n } from "../shared/i18n"
import { log } from "../shared/logger"
import { logLegacyPluginStartupWarning } from "../shared/log-legacy-plugin-startup-warning"
import { migrateLegacyWorkspaceDirectory } from "../shared/legacy-workspace-migration"
import { sweepOmoFamiliesBestEffort } from "../shared/omo-process-sweep"
import { injectServerAuthIntoClient } from "../shared/opencode-server-auth"
import { recordPluginTelemetry } from "../shared/posthog"
import {
  initLiveServerRoute,
  setLiveParentWakeRoutingDisabled,
  warmLiveServerProbe,
} from "../shared/live-server-route"
import { startBackgroundCheck as startTmuxCheck } from "../tools/interactive-bash"

type HooksWithRuntimeLifecycle = Hooks & {
  "experimental.compaction.autocontinue"?: CompactionAutocontinueHook
  dispose?: () => Promise<void>
}

export type PluginModuleDeps = {
  initConfigContext: typeof initConfigContext
  installAgentSortShim: typeof installAgentSortShim
  setAgentSortOrder: typeof setAgentSortOrder
  log: typeof log
  logLegacyPluginStartupWarning: typeof logLegacyPluginStartupWarning
  migrateLegacyWorkspaceDirectory: typeof migrateLegacyWorkspaceDirectory
  startOmoProcessSweep: () => Promise<void>
  detectDuplicateOmoPlugin: typeof detectDuplicateOmoPlugin
  getDuplicateOmoPluginWarning: typeof getDuplicateOmoPluginWarning
  detectExternalSkillPlugin: typeof detectExternalSkillPlugin
  getSkillPluginConflictWarning: typeof getSkillPluginConflictWarning
  injectServerAuthIntoClient: typeof injectServerAuthIntoClient
  initLiveServerRoute: typeof initLiveServerRoute
  setLiveParentWakeRoutingDisabled: typeof setLiveParentWakeRoutingDisabled
  warmLiveServerProbe: typeof warmLiveServerProbe
  loadPluginConfig: typeof loadPluginConfig
  recordPluginTelemetry: typeof recordPluginTelemetry
  initI18n: typeof initI18n
  initializeOpenClaw: typeof initializeOpenClaw
  stopReplyListener: typeof stopReplyListener
  isTmuxIntegrationEnabled: typeof isTmuxIntegrationEnabled
  startTmuxCheck: typeof startTmuxCheck
  createFirstMessageVariantGate: typeof createFirstMessageVariantGate
  createRuntimeTmuxConfig: typeof createRuntimeTmuxConfig
  createModelCacheState: typeof createModelCacheState
  createManagers: typeof createManagers
  createTools: typeof createTools
  createRuntimeSkillSourceServer: typeof createRuntimeSkillSourceServer
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
  startOmoProcessSweep: () => sweepOmoFamiliesBestEffort({ log }),
  detectDuplicateOmoPlugin,
  getDuplicateOmoPluginWarning,
  detectExternalSkillPlugin,
  getSkillPluginConflictWarning,
  injectServerAuthIntoClient,
  initLiveServerRoute,
  setLiveParentWakeRoutingDisabled,
  warmLiveServerProbe,
  loadPluginConfig,
  recordPluginTelemetry,
  initI18n,
  initializeOpenClaw,
  stopReplyListener,
  isTmuxIntegrationEnabled,
  startTmuxCheck,
  createFirstMessageVariantGate,
  createRuntimeTmuxConfig,
  createModelCacheState,
  createManagers,
  createTools,
  createRuntimeSkillSourceServer,
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

    // Unconditional omo process hygiene (T16): fire-and-forget family sweep,
    // throttled per-family inside the sweep functions. Never awaited and
    // never allowed to reject into startup.
    try {
      void deps
        .startOmoProcessSweep()
        .catch((error: unknown) => {
          deps.log("[oh-my-openagent] omo process sweep failed", {
            error: error instanceof Error ? error.message : String(error),
          })
        })
    } catch (error) {
      deps.log("[oh-my-openagent] omo process sweep failed to start", {
        error: error instanceof Error ? error.message : String(error),
      })
    }

    const duplicateOmoPluginCheck = deps.detectDuplicateOmoPlugin(input.directory)
    if (duplicateOmoPluginCheck.detected) {
      console.warn(deps.getDuplicateOmoPluginWarning(duplicateOmoPluginCheck.duplicatePlugins))
      return {}
    }

    const skillPluginCheck = deps.detectExternalSkillPlugin(input.directory)
    if (skillPluginCheck.detected && skillPluginCheck.pluginName) {
      console.warn(deps.getSkillPluginConflictWarning(skillPluginCheck.pluginName))
    }

    deps.injectServerAuthIntoClient(input.client)

    const pluginConfig = deps.loadPluginConfig(input.directory, input)
    try {
      deps.recordPluginTelemetry({ configEnabled: pluginConfig.telemetry })
    } catch (error) {
      deps.log("[posthog] plugin telemetry failed", {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    if (pluginConfig.tui?.sidebar?.enabled !== false) {
      try {
        ensureTuiPluginEntry()
      } catch (error) {
        deps.log("[tui-sidebar] tui.json self-heal failed", {
          error: error instanceof Error ? error.message : String(error),
        })
      }
    }
    deps.initLiveServerRoute({ serverUrl: input.serverUrl, directory: input.directory, inProcessClient: input.client })
    deps.setLiveParentWakeRoutingDisabled(pluginConfig.experimental?.disable_live_parent_wake_routing === true)
    deps.warmLiveServerProbe()
    const runtimeSecuritySkills = selectRuntimeSecuritySkills(pluginConfig)
    let runtimeSkillSource: Awaited<ReturnType<PluginModuleDeps["createRuntimeSkillSourceServer"]>> | undefined
    if (runtimeSecuritySkills.length > 0) {
      try {
        runtimeSkillSource = await deps.createRuntimeSkillSourceServer({ skills: runtimeSecuritySkills })
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error)
        console.warn(`[runtime-skills] bundled security skill source unavailable; continuing without config.skills.urls: ${detail}`)
      }
    }
    deps.initI18n(pluginConfig.i18n?.locale ? { locale: pluginConfig.i18n.locale } : undefined)
    deps.setAgentSortOrder(pluginConfig.agent_order)

    let openClawStarted = false
    try {
      if (pluginConfig.openclaw) {
        openClawStarted = await deps.initializeOpenClaw(pluginConfig.openclaw)
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
        } catch (error) {
          if (error instanceof Error) {
            console.warn("[team-mode] init failed:", error)
          } else {
            console.warn("[team-mode] init failed:", String(error))
          }
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
        runtimeSkillSourceUrl: runtimeSkillSource?.url,
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
        monitorManager: managers.monitorManager,
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

      const dispose = createPluginDispose({
        backgroundManager: managers.backgroundManager,
        skillMcpManager: managers.skillMcpManager,
        disposeHooks: hooks.disposeHooks,
        disposeOpenClaw: openClawStarted
          ? async () => {
              const result = await deps.stopReplyListener()
              if (!result.success) {
                deps.log("[OhMyOpenCodePlugin] stopReplyListener() failed during dispose", result)
              }
            }
          : undefined,
      })

      const pluginHooks: HooksWithRuntimeLifecycle = {
        ...pluginInterface,

        "experimental.session.compacting": createSessionCompactingHandler(hooks),

        "experimental.compaction.autocontinue": createCompactionAutocontinueHandler(hooks),

        dispose: async (): Promise<void> => {
          runtimeSkillSource?.stop()
          await dispose()
        },
      }

      return pluginHooks
    } catch (error) {
      if (openClawStarted) {
        try {
          const result = await deps.stopReplyListener()
          if (!result.success) {
            deps.log("[OhMyOpenCodePlugin] stopReplyListener() failed after startup failure", result)
          }
        } catch (stopError) {
          deps.log("[OhMyOpenCodePlugin] stopReplyListener() error after startup failure", stopError)
        }
      }
      throw error
    }
  }

  return {
    id: "oh-my-openagent",
    server: serverPlugin,
  }
}

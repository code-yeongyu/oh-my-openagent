import { initConfigContext } from "./cli/config-manager/config-context"
import type { Hooks, Plugin, PluginModule } from "@opencode-ai/plugin"

import type { HookName } from "./config"

import { createHooks } from "./create-hooks"
import { createManagers } from "./create-managers"
import { createRuntimeTmuxConfig, isTmuxIntegrationEnabled } from "./create-runtime-tmux-config"
import { createTools } from "./create-tools"
import { initializeOpenClaw } from "./openclaw"
import { createPluginInterface } from "./plugin-interface"

import { loadPluginConfig } from "./plugin-config"
import { createModelCacheState } from "./plugin-state"
import { createFirstMessageVariantGate } from "./shared/first-message-variant"
import { injectServerAuthIntoClient, log, logLegacyPluginStartupWarning } from "./shared"
import { detectExternalSkillPlugin, getSkillPluginConflictWarning } from "./shared/external-plugin-detector"
import { startBackgroundCheck as startTmuxCheck } from "./tools/interactive-bash"
import { createPluginPostHog, getPostHogDistinctId } from "./shared/posthog"

const serverPlugin: Plugin = async (input, _options): Promise<Hooks> => {
  initConfigContext("opencode", null)
  log("[OhMyOpenCodePlugin] ENTRY - plugin loading", {
    directory: input.directory,
  })
  logLegacyPluginStartupWarning()

  const skillPluginCheck = detectExternalSkillPlugin(input.directory)
  if (skillPluginCheck.detected && skillPluginCheck.pluginName) {
    console.warn(getSkillPluginConflictWarning(skillPluginCheck.pluginName))
  }

  injectServerAuthIntoClient(input.client)

  const pluginConfig = loadPluginConfig(input.directory, input)

  const posthog = createPluginPostHog()
  const distinctId = getPostHogDistinctId()
  try {
    posthog.trackActive(distinctId, "plugin_loaded")
  } catch {
    // telemetry failure is non-fatal, silently ignore
  }
  try {
    posthog.capture({
      distinctId,
      event: "plugin_loaded",
      properties: {
        entry_point: "plugin",
        has_openclaw: !!pluginConfig.openclaw,
        tmux_enabled: isTmuxIntegrationEnabled(pluginConfig),
      },
    })
  } catch {
    // telemetry failure is non-fatal, silently ignore
  }
  if (pluginConfig.openclaw) {
    await initializeOpenClaw(pluginConfig.openclaw)
  }
  const tmuxIntegrationEnabled = isTmuxIntegrationEnabled(pluginConfig)
  if (tmuxIntegrationEnabled) {
    startTmuxCheck()
  }
  const disabledHooks = new Set(pluginConfig.disabled_hooks ?? [])

  const isHookEnabled = (hookName: HookName): boolean => !disabledHooks.has(hookName)
  const safeHookEnabled = pluginConfig.experimental?.safe_hook_creation ?? true

  const firstMessageVariantGate = createFirstMessageVariantGate()

  const tmuxConfig = createRuntimeTmuxConfig(pluginConfig)

  const modelCacheState = createModelCacheState()

  const managers = createManagers({
    ctx: input,
    pluginConfig,
    tmuxConfig,
    modelCacheState,
    backgroundNotificationHookEnabled: isHookEnabled("background-notification"),
  })

  const toolsResult = await createTools({
    ctx: input,
    pluginConfig,
    managers,
  })

  const hooks = createHooks({
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

  const pluginInterface = createPluginInterface({
    ctx: input,
    pluginConfig,
    firstMessageVariantGate,
    managers,
    hooks,
    tools: toolsResult.filteredTools,
  })

  return {
    ...pluginInterface,

    "experimental.session.compacting": async (
      compactingInput: { sessionID: string },
      output: { context: string[] },
    ): Promise<void> => {
      await hooks.compactionContextInjector?.capture(compactingInput.sessionID)
      await hooks.compactionTodoPreserver?.capture(compactingInput.sessionID)
      await hooks.claudeCodeHooks?.["experimental.session.compacting"]?.(
        compactingInput,
        output,
      )
      if (hooks.compactionContextInjector) {
        output.context.push(hooks.compactionContextInjector.inject(compactingInput.sessionID))
      }
    },
  }
}

const pluginModule: PluginModule = {
  id: "oh-my-openagent",
  server: serverPlugin,
}

export default pluginModule

export type {
  OhMyOpenCodeConfig,
  AgentName,
  AgentOverrideConfig,
  AgentOverrides,
  McpName,
  HookName,
  BuiltinCommandName,
} from "./config"

export type { ConfigLoadError } from "./shared/config-errors"

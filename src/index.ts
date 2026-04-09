import { initConfigContext } from "./cli/config-manager/config-context"
import type { Plugin } from "@opencode-ai/plugin"

import type { HookName } from "./config"

import { createHooks } from "./create-hooks"
import { createManagers } from "./create-managers"
import { createRuntimeTmuxConfig, isTmuxIntegrationEnabled } from "./create-runtime-tmux-config"
import { createTools } from "./create-tools"
import { initializeOpenClaw } from "./openclaw"
import { createPluginInterface } from "./plugin-interface"
import { createPluginDispose, type PluginDispose } from "./plugin-dispose"

import { loadPluginConfig } from "./plugin-config"
import { createModelCacheState } from "./plugin-state"
import { createFirstMessageVariantGate } from "./shared/first-message-variant"
import { injectServerAuthIntoClient, log, logLegacyPluginStartupWarning } from "./shared"
import { detectExternalSkillPlugin, getSkillPluginConflictWarning } from "./shared/external-plugin-detector"
import { startBackgroundCheck as startTmuxCheck } from "./tools/interactive-bash"
import { lspManager } from "./tools/lsp/client"

let activePluginDispose: PluginDispose | null = null

const OhMyOpenCodePlugin: Plugin = async (ctx) => {
  initConfigContext("opencode", null)
  log("[OhMyOpenCodePlugin] ENTRY - plugin loading", {
    directory: ctx.directory,
  })
  logLegacyPluginStartupWarning()

  const skillPluginCheck = detectExternalSkillPlugin(ctx.directory)
  if (skillPluginCheck.detected && skillPluginCheck.pluginName) {
    console.warn(getSkillPluginConflictWarning(skillPluginCheck.pluginName))
  }

  injectServerAuthIntoClient(ctx.client)
  await activePluginDispose?.()

  const pluginConfig = loadPluginConfig(ctx.directory, ctx)
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
    ctx,
    pluginConfig,
    tmuxConfig,
    modelCacheState,
    backgroundNotificationHookEnabled: isHookEnabled("background-notification"),
  })

  const toolsResult = await createTools({
    ctx,
    pluginConfig,
    managers,
  })

  const hooks = createHooks({
    ctx,
    pluginConfig,
    modelCacheState,
    backgroundManager: managers.backgroundManager,
    isHookEnabled,
    safeHookEnabled,
    mergedSkills: toolsResult.mergedSkills,
    availableSkills: toolsResult.availableSkills,
  })

  const dispose = createPluginDispose({
    backgroundManager: managers.backgroundManager,
    skillMcpManager: managers.skillMcpManager,
    lspManager,
    disposeHooks: hooks.disposeHooks,
  })

  const pluginInterface = createPluginInterface({
    ctx,
    pluginConfig,
    firstMessageVariantGate,
    managers,
    hooks,
    tools: toolsResult.filteredTools,
  })

  activePluginDispose = dispose

  return {
    name: "oh-my-openagent",
    ...pluginInterface,

    "experimental.session.compacting": async (
      _input: { sessionID: string },
      output: { context: string[] },
    ): Promise<void> => {
      await hooks.compactionContextInjector?.capture(_input.sessionID)
      await hooks.compactionTodoPreserver?.capture(_input.sessionID)
      await hooks.claudeCodeHooks?.["experimental.session.compacting"]?.(
        _input,
        output,
      )
      if (hooks.compactionContextInjector) {
        output.context.push(hooks.compactionContextInjector.inject(_input.sessionID))
      }
    },
  }
}

export default OhMyOpenCodePlugin

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

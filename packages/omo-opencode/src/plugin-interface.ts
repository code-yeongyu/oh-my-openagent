import type { SessionModelProfiles } from "./plugin/session-model-profiles"
import type { PluginContext, PluginInterface, ToolsRecord } from "./plugin/types"
import type { OhMyOpenCodeConfig } from "./config"

import { applyAgentVariant } from "./shared/agent-variant"
import { isSyntheticOrInternalOnlyTextParts } from "./shared"
import { createChatParamsHandler } from "./plugin/chat-params"
import { createChatHeadersHandler } from "./plugin/chat-headers"
import { createChatMessageHandler } from "./plugin/chat-message"
import { createCommandExecuteBeforeHandler } from "./plugin/command-execute-before"
import { createMessagesTransformHandler } from "./plugin/messages-transform"
import { createSystemTransformHandler } from "./plugin/system-transform"
import { getUltraworkMessage } from "./hooks/keyword-detector/ultrawork"
import { createEventHandler } from "./plugin/event"
import { createToolDefinitionHandler } from "./plugin/tool-definition"
import { createToolExecuteAfterHandler } from "./plugin/tool-execute-after"
import { createToolExecuteBeforeHandler } from "./plugin/tool-execute-before"
import { showSkillSecurityNotice } from "./plugin/skill-security-notice"

import type { CreatedHooks } from "./create-hooks"
import type { Managers } from "./create-managers"

export function createPluginInterface(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  sessionModelProfiles?: SessionModelProfiles
  firstMessageVariantGate: {
    shouldOverride: (sessionID: string) => boolean
    markApplied: (sessionID: string) => void
    markSessionCreated: (sessionInfo: { id?: string; title?: string; parentID?: string } | undefined) => void
    clear: (sessionID: string) => void
  }
  managers: Managers
  hooks: CreatedHooks
  tools: ToolsRecord
}): PluginInterface {
  const { ctx, pluginConfig, firstMessageVariantGate, managers, hooks, tools } =
    args

  return {
    tool: tools,

    "chat.params": async (input: unknown, output: unknown) => {
      const chatParamsInput = input as {
        sessionID?: string
        agent?: string | { name?: string }
        model?: { providerID?: unknown; modelID?: unknown; id?: unknown }
        message?: { variant?: string; id?: string }
      }
      const agentName =
        typeof chatParamsInput.agent === "string"
          ? chatParamsInput.agent
          : chatParamsInput.agent?.name
      const providerID = chatParamsInput.model?.providerID
      const rawModelID = chatParamsInput.model?.modelID ?? chatParamsInput.model?.id
      const modelID = typeof rawModelID === "string" ? rawModelID : undefined
      if (chatParamsInput.message && typeof providerID === "string" && modelID !== undefined) {
        const modelConfig = chatParamsInput.sessionID ? args.sessionModelProfiles?.primaryConfig(chatParamsInput.sessionID, chatParamsInput.message?.id) : undefined
        applyAgentVariant(modelConfig ? { ...pluginConfig, ...modelConfig } : pluginConfig, agentName, chatParamsInput.message, { providerID, modelID })
      }
      const handler = createChatParamsHandler({
        client: ctx.client,
      })
      await handler(input, output)
    },

    "chat.headers": createChatHeadersHandler({ ctx }),

    "command.execute.before": createCommandExecuteBeforeHandler({
      directory: ctx.directory,
      sessionModelProfiles: args.sessionModelProfiles,
      hooks,
      mcpManager: managers.skillMcpManager,
      notify: (message) => showSkillSecurityNotice(ctx, message),
    }),

    "chat.message": async (input, output) => {
      const selected = !isSyntheticOrInternalOnlyTextParts(output.parts)
        ? await args.sessionModelProfiles?.applyPrimary(input.sessionID, input.agent, output.message)
        : args.sessionModelProfiles?.primaryConfig(input.sessionID, output.message.id)
      await createChatMessageHandler({
        ctx,
        pluginConfig: selected ? { ...pluginConfig, ...selected } : pluginConfig,
        firstMessageVariantGate,
        hooks,
      })(input, output)
    },

    "experimental.chat.messages.transform": createMessagesTransformHandler({
      hooks,
    }),

    "experimental.chat.system.transform": createSystemTransformHandler(
      pluginConfig.default_mode,
      getUltraworkMessage,
      hooks.keywordDetector,
    ),

    config: managers.configHandler,

    event: createEventHandler({
      sessionModelProfiles: args.sessionModelProfiles,
      ctx,
      pluginConfig,
      firstMessageVariantGate,
      managers,
      hooks,
    }),

    "tool.definition": createToolDefinitionHandler({
      hooks,
    }),

    "tool.execute.before": createToolExecuteBeforeHandler({
      ctx,
      hooks,
      backgroundManager: managers.backgroundManager,
    }),

    "tool.execute.after": createToolExecuteAfterHandler({
      ctx,
      hooks,
    }),
  }
}

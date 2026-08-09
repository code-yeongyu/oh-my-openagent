import { isRecord } from "@oh-my-opencode/utils"
import type { OhMyOpenCodeConfig } from "./config"
import type { PluginContext, PluginInterface, ToolsRecord } from "./plugin/types"

import { applyAgentVariant } from "./shared/agent-variant"
import { getAgentConfigKey, getSessionPromptParams } from "./shared"
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

import type { CreatedHooks } from "./create-hooks"
import type { Managers } from "./create-managers"

export function createPluginInterface(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
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
        sessionID?: unknown
        agent?: string | { name?: string }
        model?: { providerID?: unknown; modelID?: unknown; id?: unknown }
        message?: { variant?: string; reasoningEffort?: string }
      }
      const agentName =
        typeof chatParamsInput.agent === "string"
          ? chatParamsInput.agent
          : chatParamsInput.agent?.name
      const providerID = chatParamsInput.model?.providerID
      const rawModelID = chatParamsInput.model?.modelID ?? chatParamsInput.model?.id
      const modelID = typeof rawModelID === "string" ? rawModelID : undefined
      const agentConfigKey = typeof agentName === "string"
        ? getAgentConfigKey(agentName, pluginConfig.agents)
        : undefined
      const agentOverride = agentConfigKey === undefined
        ? undefined
        : pluginConfig.agents?.[agentConfigKey as keyof typeof pluginConfig.agents]
      const hasSessionPromptParams = typeof chatParamsInput.sessionID === "string"
        && getSessionPromptParams(chatParamsInput.sessionID) !== undefined
      if (!hasSessionPromptParams && chatParamsInput.message && typeof providerID === "string" && modelID !== undefined) {
        applyAgentVariant(pluginConfig, agentName, chatParamsInput.message, { providerID, modelID })
      }
      if (isRecord(output) && isRecord(output.options) && agentOverride && !hasSessionPromptParams) {
        const options = { ...output.options, ...agentOverride.providerOptions }
        if (typeof agentOverride.maxTokens === "number") {
          output.maxOutputTokens = agentOverride.maxTokens
        }
        if (agentOverride.models !== undefined) {
          if (typeof agentOverride.temperature === "number") {
            output.temperature = agentOverride.temperature
          }
          if (typeof agentOverride.top_p === "number") {
            output.topP = agentOverride.top_p
          }
          if (chatParamsInput.message?.reasoningEffort) {
            options.reasoningEffort = chatParamsInput.message.reasoningEffort
          } else if (agentOverride.reasoning === undefined && agentOverride.reasoningEffort) {
            options.reasoningEffort = agentOverride.reasoningEffort
          }
          if (agentOverride.thinking) {
            options.thinking = agentOverride.thinking
          }
          if (agentOverride.textVerbosity) {
            options.textVerbosity = agentOverride.textVerbosity
          }
        }
        output.options = options
      }
      const handler = createChatParamsHandler({
        client: ctx.client,
      })
      await handler(input, output)
    },

    "chat.headers": createChatHeadersHandler({ ctx }),

    "command.execute.before": createCommandExecuteBeforeHandler({
      directory: ctx.directory,
      hooks,
    }),

    "chat.message": createChatMessageHandler({
      ctx,
      pluginConfig,
      firstMessageVariantGate,
      hooks,
    }),

    "experimental.chat.messages.transform": createMessagesTransformHandler({
      hooks,
    }),

    "experimental.chat.system.transform": createSystemTransformHandler(
      pluginConfig.default_mode,
      getUltraworkMessage,
    ),

    config: managers.configHandler,

    event: createEventHandler({
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

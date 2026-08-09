import { isRecord } from "@oh-my-opencode/utils"
import type { OhMyOpenCodeConfig } from "./config"
import type { PluginContext, PluginInterface, ToolsRecord } from "./plugin/types"

import {
  applyAgentVariant,
  getAgentConfigKey,
  getSessionPromptParams,
  lowerReasoningForModel,
  parseModelString,
} from "./shared"
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
      const categoryOverride = agentOverride?.category
        ? pluginConfig.categories?.[agentOverride.category]
        : undefined
      const agentPrimaryEntry = agentOverride?.models?.[0]
      const agentPrimary = typeof agentPrimaryEntry === "object" ? agentPrimaryEntry : undefined
      const categoryPrimaryEntry = agentOverride?.models === undefined && agentOverride?.model === undefined
        ? categoryOverride?.models?.[0]
        : undefined
      const categoryPrimary = typeof categoryPrimaryEntry === "object" ? categoryPrimaryEntry : undefined
      const canonicalPrimaryEntry = agentOverride?.models !== undefined
        ? agentPrimaryEntry
        : categoryPrimaryEntry
      const canonicalPrimaryModel = typeof canonicalPrimaryEntry === "string"
        ? canonicalPrimaryEntry
        : canonicalPrimaryEntry?.model
      const parsedCanonicalPrimary = canonicalPrimaryModel
        ? parseModelString(canonicalPrimaryModel)
        : undefined
      const hasCanonicalPrimary = parsedCanonicalPrimary !== undefined
      const isCanonicalPrimaryRequest = parsedCanonicalPrimary !== undefined
        && providerID === parsedCanonicalPrimary.providerID
        && modelID === parsedCanonicalPrimary.modelID
      const primaryReasoning = agentPrimary?.reasoning
        ?? agentPrimary?.variant
        ?? agentOverride?.reasoning
        ?? agentOverride?.variant
        ?? categoryPrimary?.reasoning
        ?? categoryPrimary?.variant
        ?? categoryOverride?.reasoning
        ?? categoryOverride?.variant
      const primaryReasoningEffort = agentPrimary?.reasoningEffort
        ?? agentOverride?.reasoningEffort
        ?? categoryPrimary?.reasoningEffort
        ?? categoryOverride?.reasoningEffort
      const primaryProviderOptions = {
        ...(categoryOverride?.textVerbosity === undefined ? {} : { textVerbosity: categoryOverride.textVerbosity }),
        ...categoryOverride?.provider_options,
        ...categoryPrimary?.provider_options,
        ...(agentOverride?.textVerbosity === undefined ? {} : { textVerbosity: agentOverride.textVerbosity }),
        ...agentOverride?.providerOptions,
        ...agentPrimary?.provider_options,
      }
      const primaryTemperature = agentPrimary?.temperature
        ?? agentOverride?.temperature
        ?? categoryPrimary?.temperature
        ?? categoryOverride?.temperature
      const primaryTopP = agentPrimary?.top_p
        ?? agentOverride?.top_p
        ?? categoryPrimary?.top_p
        ?? categoryOverride?.top_p
      const primaryMaxTokens = agentPrimary?.max_tokens
        ?? agentPrimary?.maxTokens
        ?? agentOverride?.maxTokens
        ?? categoryPrimary?.max_tokens
        ?? categoryPrimary?.maxTokens
        ?? categoryOverride?.max_tokens
        ?? categoryOverride?.maxTokens
      const primaryThinking = agentPrimary?.thinking
        ?? agentOverride?.thinking
        ?? categoryPrimary?.thinking
        ?? categoryOverride?.thinking
      const hasSessionPromptParams = typeof chatParamsInput.sessionID === "string"
        && getSessionPromptParams(chatParamsInput.sessionID) !== undefined
      if (!hasSessionPromptParams && chatParamsInput.message && typeof providerID === "string" && modelID !== undefined) {
        if (hasCanonicalPrimary) {
          if (isCanonicalPrimaryRequest && primaryReasoning !== undefined && chatParamsInput.message.variant === undefined) {
            Object.assign(chatParamsInput.message, lowerReasoningForModel(primaryReasoning, { providerID, modelID }))
          }
        } else {
          applyAgentVariant(pluginConfig, agentName, chatParamsInput.message, { providerID, modelID })
        }
      }
      if (
        isRecord(output)
        && isRecord(output.options)
        && agentOverride
        && !hasSessionPromptParams
        && (!hasCanonicalPrimary || isCanonicalPrimaryRequest)
      ) {
        const options: Record<string, unknown> = { ...output.options, ...primaryProviderOptions }
        if (typeof primaryMaxTokens === "number") {
          output.maxOutputTokens = primaryMaxTokens
        }
        if (hasCanonicalPrimary) {
          if (typeof primaryTemperature === "number") {
            output.temperature = primaryTemperature
          }
          if (typeof primaryTopP === "number") {
            output.topP = primaryTopP
          }
          if (chatParamsInput.message?.reasoningEffort) {
            options.reasoningEffort = chatParamsInput.message.reasoningEffort
          } else if (primaryReasoning === undefined && primaryReasoningEffort) {
            options.reasoningEffort = primaryReasoningEffort
          }
          if (primaryThinking) {
            options.thinking = primaryThinking
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

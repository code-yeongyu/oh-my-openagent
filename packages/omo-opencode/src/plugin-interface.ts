import type { PluginContext, PluginInterface, ToolsRecord } from "./plugin/types"
import type { OhMyOpenCodeConfig } from "./config"

import { applyAgentVariant } from "./shared/agent-variant"
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
import { reconcileNativeModelPrompts } from "./agents/native-model-prompt"
import type { NativePromptContext } from "./agents/native-prompt-frame"
import { z } from "zod"
import { log } from "./shared/logger"

const sessionToolPermissionsSchema = z.object({
  permission: z.array(z.object({
    permission: z.string(),
    pattern: z.string(),
    action: z.enum(["allow", "ask", "deny"]),
  })).optional(),
})

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
  const toolSnippets = Object.fromEntries(
    Object.entries(tools).map(([name, definition]) => [name, definition.description]),
  )

  return {
    tool: tools,

    "chat.params": async (input: unknown, output: unknown) => {
      const chatParamsInput = input as {
        agent?: string | { name?: string }
        model?: { providerID?: unknown; modelID?: unknown; id?: unknown }
        message?: { variant?: string }
      }
      const agentName =
        typeof chatParamsInput.agent === "string"
          ? chatParamsInput.agent
          : chatParamsInput.agent?.name
      const providerID = chatParamsInput.model?.providerID
      const rawModelID = chatParamsInput.model?.modelID ?? chatParamsInput.model?.id
      const modelID = typeof rawModelID === "string" ? rawModelID : undefined
      if (chatParamsInput.message && typeof providerID === "string" && modelID !== undefined) {
        applyAgentVariant(pluginConfig, agentName, chatParamsInput.message, { providerID, modelID })
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
      hooks.keywordDetector,
      () => toolSnippets,
      async (sessionID) => {
        if (!sessionID) return []
        const sessionsApi = ctx.client.session
        if (!sessionsApi?.get) return undefined
        const response = await sessionsApi.get({
          path: { id: sessionID },
          query: { directory: ctx.directory },
          signal: AbortSignal.timeout(3000),
        }).catch((error: unknown) => {
          log("[native-prompt] Could not refresh session tool permissions", { sessionID, error })
          return undefined
        })
        if (!response?.data) return undefined
        const session = sessionToolPermissionsSchema.safeParse(response.data)
        if (!session.success) return undefined
        return (session.data.permission ?? []).map((rule) => ({
          pattern: rule.permission, permission: rule.action, scope: rule.pattern,
        }))
      },
    ),

    config: async (config) => {
      await managers.configHandler(config)
      for (const agent of Object.values(config.agent ?? {})) {
        if (!agent || typeof agent.prompt !== "string") continue
        const rules: NonNullable<NativePromptContext["toolPermissions"]> = []
        for (const [pattern, enabled] of Object.entries(config.tools ?? {})) {
          rules.push({ pattern, permission: enabled ? "allow" : "deny" })
        }
        for (const permissions of [config.permission, agent.permission]) {
          for (const [pattern, permission] of Object.entries(permissions ?? {})) {
            if (permission === "allow" || permission === "ask" || permission === "deny") {
              rules.push({ pattern, permission })
            } else if (typeof permission === "object" && permission !== null) {
              for (const [scope, action] of Object.entries(permission)) {
                if (action === "allow" || action === "ask" || action === "deny") {
                  rules.push({ pattern, permission: action, scope })
                }
              }
            }
          }
        }
        for (const pattern of pluginConfig.disabled_tools ?? []) rules.push({ pattern, permission: "deny" })
        const system = [agent.prompt]
        reconcileNativeModelPrompts(system, undefined, toolSnippets, rules)
        agent.prompt = system[0]
      }
    },

    event: createEventHandler({
      ctx,
      pluginConfig,
      firstMessageVariantGate,
      managers,
      hooks,
    }),

    "tool.definition": createToolDefinitionHandler({
      hooks,
      onDefinition: (name, description) => {
        // OpenCode defines this error handler but never exposes it as a model tool.
        if (name !== "invalid") toolSnippets[name] = description
      },
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

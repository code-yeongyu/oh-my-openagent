import type { PluginContext, PluginInterface, ToolsRecord } from "./plugin/types"
import type { OhMyOpenCodeConfig } from "./config"

import { createChatParamsHandler } from "./plugin/chat-params"
import { createChatHeadersHandler } from "./plugin/chat-headers"
import { createChatMessageHandler } from "./plugin/chat-message"
import { createMessagesTransformHandler } from "./plugin/messages-transform"
import { createSystemTransformHandler } from "./plugin/system-transform"
import { createEventHandler } from "./plugin/event"
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
      const handler = createChatParamsHandler({ anthropicEffort: hooks.anthropicEffort })
      await handler(input, output)
    },

    "chat.headers": createChatHeadersHandler({ ctx }),

    "chat.message": createChatMessageHandler({
      ctx,
      pluginConfig,
      firstMessageVariantGate,
      hooks,
    }),

    "experimental.chat.messages.transform": createMessagesTransformHandler({
      hooks,
    }),

    "experimental.chat.system.transform": createSystemTransformHandler({
      hooks,
    }),

    config: managers.configHandler,

    event: createEventHandler({
      ctx,
      pluginConfig,
      firstMessageVariantGate,
      managers,
      hooks,
    }),

    "tool.execute.before": createToolExecuteBeforeHandler({
      ctx,
      hooks,
    }),

    "tool.execute.after": createToolExecuteAfterHandler({
      hooks,
    }),
  }
}

import type { PluginInput } from "@opencode-ai/plugin"
import type { PluginConfig } from "./types"
import type { ContextCollector } from "../../features/context-injector"
import { createChatMessageHandler } from "./handlers/chat-message-handler"
import { createPreCompactHandler } from "./handlers/pre-compact-handler"
import { createSessionEventHandler } from "./handlers/session-event-handler"
import { createToolExecuteAfterHandler } from "./handlers/tool-execute-after-handler"
import { createToolExecuteBeforeHandler } from "./handlers/tool-execute-before-handler"

export function createClaudeCodeHooksHook(
  ctx: PluginInput,
  config: PluginConfig = {},
  contextCollector?: ContextCollector
) {
  return {
    "experimental.session.compacting": createPreCompactHandler(ctx, config),
    "chat.message": createChatMessageHandler(ctx, config, contextCollector),
    "tool.execute.before": createToolExecuteBeforeHandler(ctx, config),
    "tool.execute.after": createToolExecuteAfterHandler(ctx, config),
    event: createSessionEventHandler(ctx, config),
  }
}

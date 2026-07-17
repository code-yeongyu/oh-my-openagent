import type { OhMyOpenCodeConfig } from "../config"

import { updateSessionAgent } from "../features/claude-code-session-state"
import { detectSlashCommand, extractPromptText } from "../hooks/auto-slash-command/detector"
import { isSyntheticOrInternalOnlyTextParts, log } from "../shared"
import { applyUltraworkModelOverrideOnMessage } from "./ultrawork-model-override"
import type { PluginContext } from "./types"
import { handleGoalMessage, handleRalphLoopMessage } from "./chat-message/loop-commands"
import { notifyWhenModelCacheIsMissing } from "./chat-message/model-cache-warning"
import { recordSessionModel, getStoredMainSessionModel } from "./chat-message/session-model"
import { runStartWorkHookIfApplicable } from "./chat-message/start-work-message"
import { stopContinuation } from "./stop-continuation"
import type {
  ChatMessageHandlerOutput,
  ChatMessageHooks,
  ChatMessageInput,
  FirstMessageVariantGate,
} from "./chat-message/types"

export type { ChatMessageHandlerOutput, ChatMessageInput } from "./chat-message/types"

type PluginContextWithTui = {
  readonly client: {
    readonly tui: {
      readonly showToast: (input: {
        readonly body: {
          readonly title: string
          readonly message: string
          readonly variant: "warning"
          readonly duration: number
        }
      }) => Promise<unknown>
    }
  }
}

function isRuntimeFallbackEnabled(
  hooks: ChatMessageHooks,
  pluginConfig: OhMyOpenCodeConfig,
): boolean {
  return (
    hooks.runtimeFallback !== null &&
    hooks.runtimeFallback !== undefined &&
    (typeof pluginConfig.runtime_fallback === "boolean"
      ? pluginConfig.runtime_fallback
      : (pluginConfig.runtime_fallback?.enabled ?? false))
  )
}

async function runChatMessageHooks(args: {
  readonly input: ChatMessageInput
  readonly output: ChatMessageHandlerOutput
  readonly hooks: ChatMessageHooks
  readonly runtimeFallbackEnabled: boolean
}): Promise<void> {
  const { input, output, hooks, runtimeFallbackEnabled } = args
  if (!runtimeFallbackEnabled) {
    await hooks.modelFallback?.["chat.message"]?.(input, output)
  }
  recordSessionModel(input, output)
  await hooks.stopContinuationGuard?.["chat.message"]?.(input)
  await hooks.backgroundNotificationHook?.["chat.message"]?.(input, output)
  await hooks.runtimeFallback?.["chat.message"]?.(input, output)
  await hooks.keywordDetector?.["chat.message"]?.(input, output)
  await hooks.thinkMode?.["chat.message"]?.(input, output)
  await hooks.claudeCodeHooks?.["chat.message"]?.(input, output)
  await hooks.autoSlashCommand?.["chat.message"]?.(input, output)
  await hooks.noSisyphusGpt?.["chat.message"]?.(input, output)
  await hooks.noHephaestusNonGpt?.["chat.message"]?.(input, output)
  await hooks.hephaestusAgentsMdInjector?.["chat.message"]?.(input, output)
}

export function createChatMessageHandler(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  firstMessageVariantGate: FirstMessageVariantGate
  hooks: ChatMessageHooks
}): (
  input: ChatMessageInput,
  output: ChatMessageHandlerOutput
) => Promise<void> {
  const { ctx, pluginConfig, firstMessageVariantGate, hooks } = args
  const pluginContext = ctx as PluginContextWithTui
  const runtimeFallbackEnabled = isRuntimeFallbackEnabled(hooks, pluginConfig)

  return async (
    input: ChatMessageInput,
    output: ChatMessageHandlerOutput,
  ): Promise<void> => {
    if (isSyntheticOrInternalOnlyTextParts(output.parts)) {
      log("[chat-message] Skipping synthetic/internal-only message", {
        sessionID: input.sessionID,
      })
      return
    }

    if (input.agent) {
      updateSessionAgent(input.sessionID, input.agent)
    }

    const slashCommand = detectSlashCommand(extractPromptText(output.parts))
    if (slashCommand?.command === "stop-continuation") {
      stopContinuation({
        directory: ctx.directory,
        hooks,
        sessionID: input.sessionID,
      })
    }

    const isFirstMessage = firstMessageVariantGate.shouldOverride(input.sessionID)
    if (isFirstMessage) {
      firstMessageVariantGate.markApplied(input.sessionID)
    }

    const storedMainSessionModel = getStoredMainSessionModel(
      input,
      pluginConfig,
      isFirstMessage,
    )
    if (storedMainSessionModel) {
      output.message.model = storedMainSessionModel
    }

    await runChatMessageHooks({
      input,
      output,
      hooks,
      runtimeFallbackEnabled,
    })
    await runStartWorkHookIfApplicable(hooks, input, output)
    notifyWhenModelCacheIsMissing(pluginContext.client.tui)
    handleRalphLoopMessage({
      hooks,
      input,
      output,
      isFirstMessage,
      pluginConfig,
    })
    handleGoalMessage({
      hooks,
      input,
      output,
      isFirstMessage,
      pluginConfig,
    })
    await applyUltraworkModelOverrideOnMessage(
      pluginConfig,
      input.agent,
      output,
      pluginContext.client.tui,
      input.sessionID,
      pluginContext.client,
    )
  }
}

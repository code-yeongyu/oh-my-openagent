import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext } from "./types"

import { hasConnectedProvidersCache } from "../shared"
import {
  clearSessionVariant,
  getSessionVariant,
  setSessionModel,
  setSessionVariant,
} from "../shared/session-model-state"
import { setSessionAgent } from "../features/claude-code-session-state"
import { applyUltraworkModelOverrideOnMessage } from "./ultrawork-model-override"
import { parseRalphLoopArguments } from "../hooks/ralph-loop/command-arguments"
import { updateIterationSessionTitle } from "../hooks/ralph-loop/iteration-session-title"

import type { CreatedHooks } from "../create-hooks"

type FirstMessageVariantGate = {
  shouldOverride: (sessionID: string) => boolean
  markApplied: (sessionID: string) => void
}

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }
export type ChatMessageHandlerOutput = { message: Record<string, unknown>; parts: ChatMessagePart[] }
export type ChatMessageInput = {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
}
type StartWorkHookOutput = { parts: Array<{ type: string; text?: string }> }

function isStartWorkHookOutput(value: unknown): value is StartWorkHookOutput {
  if (typeof value !== "object" || value === null) return false
  const record = value as Record<string, unknown>
  const partsValue = record["parts"]
  if (!Array.isArray(partsValue)) return false
  return partsValue.every((part) => {
    if (typeof part !== "object" || part === null) return false
    const partRecord = part as Record<string, unknown>
    return typeof partRecord["type"] === "string"
  })
}

export function createChatMessageHandler(args: {
  ctx: PluginContext
  pluginConfig: OhMyOpenCodeConfig
  firstMessageVariantGate: FirstMessageVariantGate
  hooks: CreatedHooks
}): (
  input: ChatMessageInput,
  output: ChatMessageHandlerOutput
) => Promise<void> {
  const { ctx, pluginConfig, firstMessageVariantGate, hooks } = args
  const pluginContext = ctx as {
    client: {
      tui: {
        showToast: (input: {
          body: {
            title: string
            message: string
            variant: "warning"
            duration: number
          }
        }) => Promise<unknown>
      }
    }
  }
  const isRuntimeFallbackEnabled =
    hooks.runtimeFallback !== null &&
    hooks.runtimeFallback !== undefined &&
    (typeof pluginConfig.runtime_fallback === "boolean"
      ? pluginConfig.runtime_fallback
      : (pluginConfig.runtime_fallback?.enabled ?? false))

  return async (
    input: ChatMessageInput,
    output: ChatMessageHandlerOutput
  ): Promise<void> => {
    let injectedPersistedVariant = false

    if (input.agent) {
      setSessionAgent(input.sessionID, input.agent)
    }

    if (firstMessageVariantGate.shouldOverride(input.sessionID)) {
      firstMessageVariantGate.markApplied(input.sessionID)
    }

    const initialVariant = output.message["variant"]
    if (!(typeof initialVariant === "string" && initialVariant.length > 0)) {
      const persistedVariant = getSessionVariant(input.sessionID)
      if (persistedVariant !== undefined) {
        output.message["variant"] = persistedVariant
        injectedPersistedVariant = true
      }
    }

    if (!isRuntimeFallbackEnabled) {
      await hooks.modelFallback?.["chat.message"]?.(input, output)
    }

    const outputVariant = output.message["variant"]
    if (typeof outputVariant === "string" && outputVariant.length > 0) {
      setSessionVariant(input.sessionID, outputVariant)
    } else if (injectedPersistedVariant) {
      clearSessionVariant(input.sessionID)
    }

    const modelOverride = output.message["model"]
    if (
      modelOverride &&
      typeof modelOverride === "object" &&
      "providerID" in modelOverride &&
      "modelID" in modelOverride
    ) {
      const providerID = (modelOverride as { providerID?: string }).providerID
      const modelID = (modelOverride as { modelID?: string }).modelID
      if (typeof providerID === "string" && typeof modelID === "string") {
        setSessionModel(input.sessionID, { providerID, modelID })
      }
    } else if (input.model) {
      setSessionModel(input.sessionID, input.model)
    }
    await hooks.stopContinuationGuard?.["chat.message"]?.(input)
    await hooks.backgroundNotificationHook?.["chat.message"]?.(input, output)
    await hooks.runtimeFallback?.["chat.message"]?.(input, output)
    await hooks.keywordDetector?.["chat.message"]?.(input, output)
    await hooks.thinkMode?.["chat.message"]?.(input, output)
    await hooks.claudeCodeHooks?.["chat.message"]?.(input, output)
    await hooks.autoSlashCommand?.["chat.message"]?.(input, output)
    await hooks.noSisyphusGpt?.["chat.message"]?.(input, output)
    await hooks.noHephaestusNonGpt?.["chat.message"]?.(input, output)
    if (hooks.startWork && isStartWorkHookOutput(output)) {
      await hooks.startWork["chat.message"]?.(input, output)
    }

    if (!hasConnectedProvidersCache()) {
      pluginContext.client.tui
        .showToast({
          body: {
            title: "⚠️ Provider Cache Missing",
            message:
              "Model filtering disabled. RESTART OpenCode to enable full functionality.",
            variant: "warning" as const,
            duration: 6000,
          },
        })
        .catch(() => {})
    }

    if (hooks.ralphLoop) {
      const parts = output.parts
      const promptText =
        parts
          ?.filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim() || ""

      const isRalphLoopTemplate =
        promptText.includes("You are starting a Ralph Loop") &&
        promptText.includes("<user-task>")
      const isRalphResetIterationPrompt =
        promptText.includes("[RALPH LOOP - Iteration ") &&
        promptText.includes("<command-instruction>") &&
        promptText.includes("<user-task>")
      const isCancelRalphTemplate = promptText.includes(
        "Cancel the currently active Ralph Loop",
      )
      const activeRalphLoopState = hooks.ralphLoop.getState()
      const isActiveRalphLoopSession =
        activeRalphLoopState?.active === true && activeRalphLoopState.session_id === input.sessionID

      if (isRalphLoopTemplate && !isRalphResetIterationPrompt && !isActiveRalphLoopSession) {
        const taskMatch = promptText.match(/<user-task>\s*([\s\S]*?)\s*<\/user-task>/i)
        const rawTask = taskMatch?.[1]?.trim() || ""
        const parsedArguments = parseRalphLoopArguments(rawTask)

        const started = hooks.ralphLoop.startLoop(input.sessionID, parsedArguments.prompt, {
          maxIterations: parsedArguments.maxIterations,
          completionPromise: parsedArguments.completionPromise,
          strategy: parsedArguments.strategy,
        })

        if (started) {
          const loopState = hooks.ralphLoop.getState()
          if (
            loopState?.active &&
            loopState.session_id === input.sessionID &&
            (loopState.strategy === "reset" || loopState.strategy === "continue")
          ) {
            await updateIterationSessionTitle(
              ctx.client,
              input.sessionID,
              ctx.directory,
              loopState.iteration,
              loopState.max_iterations,
            )
          }
        }
      } else if (isCancelRalphTemplate) {
        hooks.ralphLoop.cancelLoop(input.sessionID)
      }
    }

    applyUltraworkModelOverrideOnMessage(pluginConfig, input.agent, output, pluginContext.client.tui, input.sessionID)
  }
}

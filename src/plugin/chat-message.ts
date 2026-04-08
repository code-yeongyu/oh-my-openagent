import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext } from "./types"

import { hasConnectedProvidersCache } from "../shared"
import { getAgentConfigKey } from "../shared/agent-display-names"
import { getSessionModel, setSessionModel } from "../shared/session-model-state"
import { getMainSessionID, setSessionAgent, subagentSessions } from "../features/claude-code-session-state"
import { applyUltraworkModelOverrideOnMessage } from "./ultrawork-model-override"
import { parseRalphLoopArguments } from "../hooks/ralph-loop/command-arguments"

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

type SessionModelOverride = { providerID: string; modelID: string }

type RawLoopCommand =
  | { command: "ralph-loop" | "ulw-loop"; args: string }
  | { command: "cancel-ralph"; args: "" }

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

function hasExplicitAgentModelOverride(
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig
): boolean {
  const configuredAgents = pluginConfig.agents
  const normalizedAgent = typeof agent === "string" ? getAgentConfigKey(agent) : undefined
  if (!normalizedAgent || !configuredAgents || !(normalizedAgent in configuredAgents)) {
    return false
  }

  const configuredAgent = configuredAgents[normalizedAgent as keyof typeof configuredAgents]
  const configuredModel = configuredAgent?.model
  return typeof configuredModel === "string" && configuredModel.trim().length > 0
}

function getStoredMainSessionModel(
  input: ChatMessageInput,
  pluginConfig: OhMyOpenCodeConfig,
  isFirstMessage: boolean,
  output: ChatMessageHandlerOutput
): SessionModelOverride | undefined {
  if (isFirstMessage) {
    return undefined
  }

  if (subagentSessions.has(input.sessionID)) {
    return undefined
  }

  if (getMainSessionID() !== input.sessionID) {
    return undefined
  }

  if (input.model) {
    return undefined
  }

  if (output.message["model"] !== undefined) {
    return undefined
  }

  if (hasExplicitAgentModelOverride(input.agent, pluginConfig)) {
    return undefined
  }

  return getSessionModel(input.sessionID)
}

function parseRawLoopSlashCommand(promptText: string): RawLoopCommand | null {
  const trimmed = promptText.trim()
  const commandText = trimmed.startsWith("/")
    ? trimmed
    : trimmed
        .split("\n")
        .map((line) => line.trim())
        .filter((line) => /^\/(?:ralph-loop|ulw-loop|cancel-ralph)\b/i.test(line))
        .at(-1)

  if (!commandText) {
    return null
  }

  const cancelMatch = commandText.match(/^\/cancel-ralph(?:\s+.*)?$/i)
  if (cancelMatch) {
    return { command: "cancel-ralph", args: "" }
  }

  const loopMatch = commandText.match(/^\/(ralph-loop|ulw-loop)\s*([\s\S]*)$/i)
  if (!loopMatch) {
    return null
  }

  const command = loopMatch[1]?.toLowerCase()
  const args = loopMatch[2]?.trim() ?? ""

  if (command === "ralph-loop" || command === "ulw-loop") {
    return { command, args }
  }

  return null
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
    if (input.agent) {
      setSessionAgent(input.sessionID, input.agent)
    }

    const isFirstMessage = firstMessageVariantGate.shouldOverride(input.sessionID)
    if (isFirstMessage) {
      firstMessageVariantGate.markApplied(input.sessionID)
    }

    const storedMainSessionModel = getStoredMainSessionModel(
      input,
      pluginConfig,
      isFirstMessage,
      output,
    )
    if (storedMainSessionModel) {
      output.message["model"] = storedMainSessionModel
    }

    if (!isRuntimeFallbackEnabled) {
      await hooks.modelFallback?.["chat.message"]?.(input, output)
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
      const isUlwLoopTemplate =
        promptText.includes("You are starting an ULTRAWORK Loop") &&
        promptText.includes("<user-task>")
      const isCancelRalphTemplate = promptText.includes(
        "Cancel the currently active Ralph Loop",
      )
      const rawLoopCommand =
        !isRalphLoopTemplate && !isUlwLoopTemplate && !isCancelRalphTemplate
          ? parseRawLoopSlashCommand(promptText)
          : null

      if (isRalphLoopTemplate || isUlwLoopTemplate || rawLoopCommand?.command === "ralph-loop" || rawLoopCommand?.command === "ulw-loop") {
        const taskMatch = promptText.match(/<user-task>\s*([\s\S]*?)\s*<\/user-task>/i)
        const rawTask = taskMatch?.[1]?.trim() || rawLoopCommand?.args || ""
        const parsedArguments = parseRalphLoopArguments(rawTask)
        const ultrawork = isUlwLoopTemplate || rawLoopCommand?.command === "ulw-loop"

        hooks.ralphLoop.startLoop(input.sessionID, parsedArguments.prompt, {
          ultrawork,
          maxIterations: parsedArguments.maxIterations,
          completionPromise: parsedArguments.completionPromise,
          strategy: parsedArguments.strategy,
        })
      } else if (isCancelRalphTemplate || rawLoopCommand?.command === "cancel-ralph") {
        hooks.ralphLoop.cancelLoop(input.sessionID)
      }
    }

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

import type { OhMyOpenCodeConfig } from "../config"
import type { PluginContext } from "./types"

import { isModelCacheAvailable, log } from "../shared"
import { getAgentConfigKey } from "../shared/agent-display-names"
import { getSessionModel, setSessionModel } from "../shared/session-model-state"
import { getMainSessionID, setSessionAgent, subagentSessions } from "../features/claude-code-session-state"
import { applyUltraworkModelOverrideOnMessage } from "./ultrawork-model-override"
import { NATIVE_LOOP_TRIGGERED_FLAG } from "./command-execute-before"
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
const START_WORK_TEMPLATE_MARKER = "You are starting a Sisyphus work session."

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

function getAgentConfiguredModelString(
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig
): string | undefined {
  const configuredAgents = pluginConfig.agents
  const normalizedAgent = typeof agent === "string" ? getAgentConfigKey(agent) : undefined
  if (!normalizedAgent || !configuredAgents || !(normalizedAgent in configuredAgents)) {
    return undefined
  }

  const configuredAgent = configuredAgents[normalizedAgent as keyof typeof configuredAgents]
  const configuredModel = configuredAgent?.model
  return typeof configuredModel === "string" && configuredModel.trim().length > 0
    ? configuredModel.trim()
    : undefined
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

  const stored = getSessionModel(input.sessionID)
  if (!stored) return undefined

  const agentDefault = getAgentConfiguredModelString(input.agent, pluginConfig)
  const storedStr = `${stored.providerID}/${stored.modelID}`

  // When opencode forwards input.model (the agent-resolved default) on follow-up
  // messages after a TUI refresh, the stored user pin must win over the agent default.
  // Only skip recovery if (a) no stored pin exists, (b) incoming already matches the
  // stored pin (no override needed), or (c) incoming differs from the agent default
  // (meaning the user explicitly chose a model in the TUI — respect that choice).
  if (input.model) {
    const incomingStr = `${input.model.providerID}/${input.model.modelID}`
    if (incomingStr === storedStr) return undefined
    if (!agentDefault || incomingStr !== agentDefault) {
      // Not the agent default — user explicitly picked this model; respect it
      return undefined
    }
    // Fall through: incoming IS the agent default, restore the stored pin
  }

  // Similarly, when agents.<role>.model exists in config, only skip recovery when
  // the stored pin already matches that default (no user override is active).
  if (hasExplicitAgentModelOverride(input.agent, pluginConfig)) {
    if (agentDefault && storedStr === agentDefault) return undefined
    // Fall through: stored pin differs from agent config default — restore it
  }

  return stored
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

function extractPromptText(parts: ChatMessagePart[]): string {
  return (
    parts
      ?.filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n")
      .trim() || ""
  )
}

function isStartWorkFallbackTemplate(promptText: string): boolean {
  return (
    promptText.includes("<session-context>") &&
    promptText.includes(START_WORK_TEMPLATE_MARKER)
  )
}

function clearStoppedContinuationBeforeWorkStart(
  hooks: CreatedHooks,
  sessionID: string,
  command: "start-work" | "ralph-loop" | "ulw-loop"
): void {
  if (hooks.stopContinuationGuard?.isStopped(sessionID)) {
    hooks.stopContinuationGuard.clear(sessionID)
    log("[stop-continuation] Stop state cleared by chat.message work-starting command", {
      sessionID,
      command,
    })
  }
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
            variant: string
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

  const lastPinRestoredToastKey = new Map<string, string>()

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
      // Don't clobber a model another hook already chose (e.g. runtime-fallback
      // resolving a chain advance). The pin restore is for the silent-revert-to-
      // role-default case — when output.message.model is unset OR equals the
      // agent default — not for displacing an active fallback decision.
      const existingOverride = output.message["model"] as
        | { providerID?: string; modelID?: string }
        | undefined
      const existingOverrideStr = existingOverride && existingOverride.providerID && existingOverride.modelID
        ? `${existingOverride.providerID}/${existingOverride.modelID}`
        : undefined
      const pinStr = `${storedMainSessionModel.providerID}/${storedMainSessionModel.modelID}`
      const agentDefault = getAgentConfiguredModelString(input.agent, pluginConfig)
      const otherHookOwnsOverride = existingOverrideStr !== undefined
        && existingOverrideStr !== pinStr
        && (agentDefault === undefined || existingOverrideStr !== agentDefault)
      if (!otherHookOwnsOverride) {
        output.message["model"] = storedMainSessionModel
        const pinKey = `${input.sessionID}:${pinStr}`
        if (lastPinRestoredToastKey.get(input.sessionID) !== pinKey) {
          lastPinRestoredToastKey.set(input.sessionID, pinKey)
          pluginContext.client.tui
            .showToast({
              body: {
                title: "Model pinned",
                message: `Using your pinned model: ${pinStr}`,
                variant: "info",
                duration: 4000,
              },
            })
            .catch(() => {})
        }
      }
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
      const promptText = extractPromptText(output.parts)
      if (isStartWorkFallbackTemplate(promptText)) {
        clearStoppedContinuationBeforeWorkStart(hooks, input.sessionID, "start-work")
      }
      await hooks.startWork["chat.message"]?.(input, output)
    }

    if (!isModelCacheAvailable()) {
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

    if (hooks.ralphLoop && output.message[NATIVE_LOOP_TRIGGERED_FLAG] !== true) {
      const parts = output.parts
      const promptText = extractPromptText(parts)

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
        const command = ultrawork ? "ulw-loop" : "ralph-loop"

        clearStoppedContinuationBeforeWorkStart(hooks, input.sessionID, command)
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

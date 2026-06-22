import type { MatrixxConfig } from "../config"
import type { CreatedHooks } from "../create-hooks"
import {
  setSessionAgent,
} from "../features/claude-code-session-state"
import { hasConnectedProvidersCache } from "../shared"
import {
  applyAgentVariant,
  resolveAgentVariant,
  resolveVariantForModel,
} from "../shared/agent-variant"
import type { PluginContext } from "./types"

type FirstMessageVariantGate = {
  shouldOverride: (sessionID: string) => boolean
  markApplied: (sessionID: string) => void
}

type ChatMessagePart = { type: string; text?: string; [key: string]: unknown }
type ChatMessageHandlerOutput = { message: Record<string, unknown>; parts: ChatMessagePart[] }
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
  pluginConfig: MatrixxConfig
  firstMessageVariantGate: FirstMessageVariantGate
  hooks: CreatedHooks
}): (
  input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
  output: ChatMessageHandlerOutput
) => Promise<void> {
  const { ctx, pluginConfig, firstMessageVariantGate, hooks } = args

  return async (
    input: { sessionID: string; agent?: string; model?: { providerID: string; modelID: string } },
    output: ChatMessageHandlerOutput
  ): Promise<void> => {
    if (input.agent) {
      setSessionAgent(input.sessionID, input.agent)
    }

    const message = output.message

    if (firstMessageVariantGate.shouldOverride(input.sessionID)) {
      if (message["variant"] === undefined) {
        const variant =
          input.model && input.agent
            ? resolveVariantForModel(pluginConfig, input.agent, input.model)
            : resolveAgentVariant(pluginConfig, input.agent)
        if (variant !== undefined) {
          message["variant"] = variant
        }
      }
      firstMessageVariantGate.markApplied(input.sessionID)
    } else {
      if (input.model && input.agent && message["variant"] === undefined) {
        const variant = resolveVariantForModel(pluginConfig, input.agent, input.model)
        if (variant !== undefined) {
          message["variant"] = variant
        }
      } else {
        applyAgentVariant(pluginConfig, input.agent, message)
      }
    }

    await hooks.stopContinuationGuard?.["chat.message"]?.(input)
    await hooks.keywordDetector?.["chat.message"]?.(input, output)
    await hooks.autoSlashCommand?.["chat.message"]?.(input, output)
    if (hooks.startWork && isStartWorkHookOutput(output)) {
      await hooks.startWork["chat.message"]?.(input, output)
    }

    if (!hasConnectedProvidersCache()) {
      ctx.client.tui
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

    if (hooks.matrixLoop) {
      const parts = output.parts
      const promptText =
        parts
          ?.filter((p) => p.type === "text" && p.text)
          .map((p) => p.text)
          .join("\n")
          .trim() || ""

      const isMatrixLoopTemplate =
        promptText.includes("You are starting a Matrix Loop") &&
        promptText.includes("<user-task>")
      const isCancelMatrixTemplate = promptText.includes(
        "Cancel the currently active Matrix Loop",
      )

      if (isMatrixLoopTemplate) {
        const taskMatch = promptText.match(/<user-task>\s*([\s\S]*?)\s*<\/user-task>/i)
        const rawTask = taskMatch?.[1]?.trim() || ""
        const quotedMatch = rawTask.match(/^["'](.+?)["']/)
        const prompt =
          quotedMatch?.[1] ||
          rawTask.split(/\s+--/)[0]?.trim() ||
          "Complete the task as instructed"

        const maxIterMatch = rawTask.match(/--max-iterations=(\d+)/i)
        const promiseMatch = rawTask.match(
          /--completion-promise=["']?([^"'\s]+)["']?/i,
        )

        hooks.matrixLoop.startLoop(input.sessionID, prompt, {
          maxIterations: maxIterMatch ? parseInt(maxIterMatch[1], 10) : undefined,
          completionPromise: promiseMatch?.[1],
        })
      } else if (isCancelMatrixTemplate) {
        hooks.matrixLoop.cancelLoop(input.sessionID)
      }
    }
  }
}

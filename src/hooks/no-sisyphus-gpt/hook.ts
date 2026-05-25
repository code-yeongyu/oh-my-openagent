import type { PluginInput } from "@opencode-ai/plugin"
import { isGptModel, isGptNativeSisyphusModel } from "../../agents/types"
import {
  getSessionAgent,
  resolveRegisteredAgentName,
  updateSessionAgent,
} from "../../features/claude-code-session-state"
import { AGENT_MODEL_REQUIREMENTS, log } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent-display-names"

const TOAST_TITLE = "绝不要将 Sisyphus 与 GPT 一起使用"
const TOAST_MESSAGE = [
  "Sisyphus 最适合与 Claude Opus 一起使用，与 Kimi/GLM 模型也可以正常工作。",
  "不要将 Sisyphus 与 GPT 一起使用（除了有专门支持的 GPT-5.4 和 GPT-5.5）。",
  "对于其他 GPT 模型，请始终使用 Hephaestus。",
].join("\n")
function showToast(ctx: PluginInput, sessionID: string): void {
  ctx.client.tui.showToast({
    body: {
      title: TOAST_TITLE,
      message: TOAST_MESSAGE,
      variant: "error",
      duration: 10000,
    },
  }).catch((error) => {
    log("[no-sisyphus-gpt] Failed to show toast", {
      sessionID,
      error,
    })
  })
}

function getNativeSisyphusGptVariant(model: { providerID: string; modelID: string }): string | undefined {
  const chain = AGENT_MODEL_REQUIREMENTS["sisyphus"]?.fallbackChain ?? []
  const exactMatch = chain.find((entry) =>
    entry.providers.includes(model.providerID) && entry.model === model.modelID
  )
  if (exactMatch?.variant !== undefined) {
    return exactMatch.variant
  }

  return chain.find((entry) => entry.model === model.modelID)?.variant
}

export function createNoSisyphusGptHook(ctx: PluginInput) {
  return {
    "chat.message": async (input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
    }, output?: {
      message?: { agent?: string; [key: string]: unknown }
    }): Promise<void> => {
      const rawAgent = input.agent ?? getSessionAgent(input.sessionID) ?? ""
      const agentKey = getAgentConfigKey(rawAgent)
      const modelID = input.model?.modelID

      if (
        agentKey === "sisyphus"
        && input.model
        && modelID
        && isGptNativeSisyphusModel(modelID)
        && output?.message
        && output.message.variant === undefined
      ) {
        const variant = getNativeSisyphusGptVariant(input.model)
        if (variant !== undefined) {
          output.message.variant = variant
        }
      }

      if (agentKey === "sisyphus" && modelID && isGptModel(modelID) && !isGptNativeSisyphusModel(modelID)) {
        showToast(ctx, input.sessionID)
        input.agent = resolveRegisteredAgentName("hephaestus") ?? "hephaestus"
        if (output?.message) {
          output.message.agent = resolveRegisteredAgentName("hephaestus") ?? "hephaestus"
        }
        updateSessionAgent(input.sessionID, "hephaestus")
      }
    },
  }
}

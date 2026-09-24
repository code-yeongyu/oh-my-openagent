import type { PluginInput } from "@opencode-ai/plugin"
import { isGpt5_5Model, isGpt6Model, isGptModel, isGptNativeSisyphusModel } from "../../agents/types"
import {
  getSessionAgent,
  isAgentRegistered,
  resolveRegisteredAgentName,
  updateSessionAgent,
} from "../../features/claude-code-session-state"
import { AGENT_MODEL_REQUIREMENTS, log } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent-display-names"

const TOAST_TITLE = "NEVER Use Sisyphus with GPT"
const TOAST_MESSAGE = [
  "Sisyphus works best with Claude Opus, and works fine with Kimi/GLM models.",
  "Do NOT use Sisyphus with GPT (except GPT-5.4, GPT-5.5, and GPT-5.6 Sol, which have GPT-native prompt support).",
  "For other GPT models, always use Hephaestus.",
].join("\n")
const HEPHAESTUS_UNAVAILABLE_TOAST_MESSAGE = [
  "Sisyphus is running with a GPT model it has no native prompt for.",
  "Hephaestus is not available in this session (disabled, or its configured model is not a supported GPT model), so the agent was not switched.",
  "Use a Claude, Kimi, or GLM model for Sisyphus, or enable Hephaestus with a supported GPT model.",
].join("\n")

function showToast(ctx: PluginInput, sessionID: string, message: string): void {
  ctx.client.tui.showToast({
    body: {
      title: TOAST_TITLE,
      message,
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
  if (isGpt5_5Model(model.modelID)) return "medium"
  if (isGpt6Model(model.modelID)) return "high"

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
        && (isGptNativeSisyphusModel(modelID) || isGpt6Model(modelID))
        && output?.message
        && output.message.variant === undefined
      ) {
        const variant = getNativeSisyphusGptVariant(input.model)
        if (variant !== undefined) {
          output.message.variant = variant
        }
      }

      if (agentKey === "sisyphus" && modelID && isGptModel(modelID) && !isGptNativeSisyphusModel(modelID) && !isGpt6Model(modelID)) {
        if (!isAgentRegistered("hephaestus")) {
          showToast(ctx, input.sessionID, HEPHAESTUS_UNAVAILABLE_TOAST_MESSAGE)
          log("[no-sisyphus-gpt] Hephaestus is not registered; keeping Sisyphus instead of redirecting", {
            sessionID: input.sessionID,
            modelID,
          })
          return
        }

        const hephaestusAgent = resolveRegisteredAgentName("hephaestus") ?? "hephaestus"
        showToast(ctx, input.sessionID, TOAST_MESSAGE)
        input.agent = hephaestusAgent
        if (output?.message) {
          output.message.agent = hephaestusAgent
        }
        updateSessionAgent(input.sessionID, "hephaestus")
      }
    },
  }
}

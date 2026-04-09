import type { PluginInput } from "@opencode-ai/plugin"
import { isGptModel, isGpt5_4Model } from "../../agents/types"
import {
  getSessionAgent,
  resolveRegisteredAgentName,
  updateSessionAgent,
} from "../../features/claude-code-session-state"
import { log } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent-display-names"

const TOAST_TITLE = "NEVER Use Sisyphus with GPT"
const TOAST_MESSAGE = [
  "Sisyphus works best with Claude Opus, and works fine with Kimi/GLM models.",
  "Do NOT use Sisyphus with GPT (except GPT-5.4 which has specialized support).",
  "For GPT models (other than 5.4), always use Hephaestus.",
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

      if (agentKey === "sisyphus" && modelID && isGptModel(modelID) && !isGpt5_4Model(modelID)) {
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

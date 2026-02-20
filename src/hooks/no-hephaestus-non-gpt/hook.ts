import type { PluginInput } from "@opencode-ai/plugin"
import { isGptModel } from "../../agents/types"
import { getSessionAgent, updateSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared"
import { getAgentConfigKey, getAgentDisplayName } from "../../shared/agent-display-names"

const TOAST_TITLE = "NEVER Use Hephaestus with Non-GPT"
const TOAST_MESSAGE = [
  "Hephaestus is designed exclusively for GPT models.",
  "Hephaestus is trash without GPT.",
  "For Claude/Kimi/GLM models, always use Sisyphus.",
].join("\n")
const SISYPHUS_DISPLAY = getAgentDisplayName("sisyphus")

function showToast(ctx: PluginInput, sessionID: string): void {
  ctx.client.tui.showToast({
    body: {
      title: TOAST_TITLE,
      message: TOAST_MESSAGE,
      variant: "error",
      duration: 10000,
    },
  }).catch((error) => {
    log("[no-hephaestus-non-gpt] Failed to show toast", {
      sessionID,
      error,
    })
  })
}

export function createNoHephaestusNonGptHook(ctx: PluginInput) {
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

      if (agentKey === "hephaestus" && modelID && !isGptModel(modelID)) {
        showToast(ctx, input.sessionID)
        input.agent = SISYPHUS_DISPLAY
        if (output?.message) {
          output.message.agent = SISYPHUS_DISPLAY
        }
        updateSessionAgent(input.sessionID, SISYPHUS_DISPLAY)
      }
    },
  }
}

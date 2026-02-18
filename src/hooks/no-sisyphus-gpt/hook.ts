import type { PluginInput } from "@opencode-ai/plugin"
import { isGptModel } from "../../agents/types"
import { getSessionAgent, updateSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared"
import { getAgentConfigKey, getAgentDisplayName } from "../../shared/agent-display-names"

const TOAST_TITLE = "NEVER Use Sisyphus with GPT"
const TOAST_MESSAGE = [
  "Sisyphus is NOT designed for GPT models.",
  "Sisyphus + GPT performs worse than vanilla Codex.",
  "You are literally burning money.",
  "Use Hephaestus for GPT models instead.",
].join("\n")
const HEPHAESTUS_DISPLAY = getAgentDisplayName("hephaestus")

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

      if (agentKey === "sisyphus" && modelID && isGptModel(modelID)) {
        showToast(ctx, input.sessionID)
        input.agent = HEPHAESTUS_DISPLAY
        if (output?.message) {
          output.message.agent = HEPHAESTUS_DISPLAY
        }
        updateSessionAgent(input.sessionID, HEPHAESTUS_DISPLAY)
      }
    },
  }
}

import type { PluginInput } from "@opencode-ai/plugin"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared"

const TOAST_TITLE = "Use Hephaestus for GPT Models"
const TOAST_MESSAGE = "Sisyphus is using a GPT model. Use Hephaestus and include 'ulw' in your prompt."

export function createSisyphusGptHephaestusReminderHook(ctx: PluginInput) {
  return {
    "chat.message": async (input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
    }): Promise<void> => {
      const agentName = (input.agent ?? getSessionAgent(input.sessionID) ?? "").toLowerCase()
      const modelID = input.model?.modelID?.toLowerCase() ?? ""

      if (agentName !== "sisyphus" || !modelID.includes("gpt")) {
        return
      }

      await ctx.client.tui.showToast({
        body: {
          title: TOAST_TITLE,
          message: TOAST_MESSAGE,
          variant: "error",
          duration: 5000,
        },
      }).catch((error) => {
        log("[sisyphus-gpt-hephaestus-reminder] Failed to show toast", {
          sessionID: input.sessionID,
          error,
        })
      })
    },
  }
}

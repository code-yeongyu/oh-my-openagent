import type { PluginInput } from "@opencode-ai/plugin"
import { isGptModel } from "../../agents/types"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { log } from "../../shared"
import { getAgentConfigKey } from "../../shared/agent-display-names"

const TOAST_TITLE = "Recommendation: Use GPT with Hephaestus"
const TOAST_MESSAGE = [
  "Hephaestus is optimized for GPT models (GPT-5.3 Codex recommended).",
  "Performance with non-GPT models may be suboptimal.",
  "For best results with Claude/Kimi/GLM, consider using Sisyphus instead.",
].join("\n")

async function showToast(ctx: PluginInput, sessionID: string): Promise<boolean> {
  try {
    await ctx.client.tui.showToast({
      body: {
        title: TOAST_TITLE,
        message: TOAST_MESSAGE,
        variant: "warning",
        duration: 8000,
      },
    })
    return true
  } catch (error) {
    log("[no-hephaestus-non-gpt] Failed to show toast", {
      sessionID,
      error,
    })
    return false
  }
}

// Track which sessions have already been warned to avoid spamming
const warnedSessions = new Set<string>()

export function createNoHephaestusNonGptHook(ctx: PluginInput) {
  return {
    "chat.message": async (input: {
      sessionID: string
      agent?: string
      model?: { providerID: string; modelID: string }
    }): Promise<void> => {
      const rawAgent = input.agent ?? getSessionAgent(input.sessionID) ?? ""
      const agentKey = getAgentConfigKey(rawAgent)
      const modelID = input.model?.modelID

      // Show warning once per session when Hephaestus is used with non-GPT
      // Only add to warnedSessions after successful toast delivery to allow retries on failure
      if (agentKey === "hephaestus" && modelID && !isGptModel(modelID)) {
        if (!warnedSessions.has(input.sessionID)) {
          const success = await showToast(ctx, input.sessionID)
          if (success) {
            warnedSessions.add(input.sessionID)
          }
        }
      }
    },
  }
}

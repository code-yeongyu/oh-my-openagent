import type { PluginInput } from "@opencode-ai/plugin"
import { isGptModel } from "../../agents/types"
import {
  getSessionAgent,
  resolveRegisteredAgentName,
  updateSessionAgent,
} from "../../features/claude-code-session-state"
import { log } from "../../shared"
import { getAgentConfigKey, normalizeAgentForPrompt } from "../../shared/agent-display-names"

const TOAST_TITLE = "NEVER Use Hephaestus with Non-GPT"
const TOAST_MESSAGE = [
  "Hephaestus is designed exclusively for GPT models.",
  "Hephaestus is trash without GPT.",
  "For Claude/Kimi/GLM models, always use Sisyphus.",
].join("\n")
type NoHephaestusNonGptHookOptions = {
  allowNonGptModel?: boolean
}

function showToast(ctx: PluginInput, sessionID: string, variant: "error" | "warning"): void {
  ctx.client.tui.showToast({
    body: {
      title: TOAST_TITLE,
      message: TOAST_MESSAGE,
      variant,
      duration: 10000,
    },
  }).catch((error) => {
    log("[no-hephaestus-non-gpt] Failed to show toast", {
      sessionID,
      error,
    })
  })
}

export function createNoHephaestusNonGptHook(
  ctx: PluginInput,
  options?: NoHephaestusNonGptHookOptions,
) {
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
      const allowNonGptModel = options?.allowNonGptModel === true

      if (agentKey === "hephaestus" && modelID && !isGptModel(modelID)) {
        showToast(ctx, input.sessionID, allowNonGptModel ? "warning" : "error")
        if (allowNonGptModel) {
          return
        }
        // Prefer the live registered name; fall back to the static display name.
        // resolveRegisteredAgentName returns the bare config key when the registry
        // has not resolved it yet, which would later fail with "Agent not found"
        // once stored on the session (#4140).
        const registeredSisyphus = resolveRegisteredAgentName("sisyphus")
        const sisyphusAgent = registeredSisyphus !== undefined
          && registeredSisyphus !== getAgentConfigKey("sisyphus")
          ? registeredSisyphus
          : normalizeAgentForPrompt("sisyphus") ?? "sisyphus"
        input.agent = sisyphusAgent
        if (output?.message) {
          output.message.agent = sisyphusAgent
        }
        updateSessionAgent(input.sessionID, sisyphusAgent)
      }
    },
  }
}

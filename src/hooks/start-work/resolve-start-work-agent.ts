import type { PluginInput } from "@opencode-ai/plugin"
import { isGpt5_4Model, isGptModel } from "../../agents/types"
import { isAgentRegistered } from "../../features/claude-code-session-state"
import { resolveRecentModelForSession } from "../atlas/recent-model-resolver"

function resolveDefaultStartWorkAgent(): "atlas" | "sisyphus" {
  return isAgentRegistered("atlas") ? "atlas" : "sisyphus"
}

function shouldUseHephaestus(modelID: string | undefined): boolean {
  return typeof modelID === "string"
    && isGptModel(modelID)
    && !isGpt5_4Model(modelID)
}

export async function resolveStartWorkAgent(
  ctx: PluginInput,
  sessionID: string,
): Promise<"atlas" | "sisyphus" | "hephaestus"> {
  const fallbackAgent = resolveDefaultStartWorkAgent()
  if (!isAgentRegistered("hephaestus")) {
    return fallbackAgent
  }

  const recentModel = await resolveRecentModelForSession(ctx, sessionID)
  if (shouldUseHephaestus(recentModel?.modelID)) {
    return "hephaestus"
  }

  return fallbackAgent
}

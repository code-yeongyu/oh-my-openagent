import type { PluginInput } from "@opencode-ai/plugin"
import { MULTIMODAL_LOOKER_AGENT } from "./constants"
import { log } from "../../shared"

type AgentModel = { providerID: string; modelID: string }

type ResolvedAgentMetadata = {
  agentModel?: AgentModel
  agentVariant?: string
}

type AgentInfo = {
  name?: string
  model?: AgentModel
  variant?: string
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function toAgentInfo(value: unknown): AgentInfo | null {
  if (!isObject(value)) return null
  const name = typeof value["name"] === "string" ? value["name"] : undefined
  const variant = typeof value["variant"] === "string" ? value["variant"] : undefined
  const modelValue = value["model"]
  const model =
    isObject(modelValue) &&
    typeof modelValue["providerID"] === "string" &&
    typeof modelValue["modelID"] === "string"
      ? { providerID: modelValue["providerID"], modelID: modelValue["modelID"] }
      : undefined
  return { name, model, variant }
}

export async function resolveMultimodalLookerAgentMetadata(
  ctx: PluginInput
): Promise<ResolvedAgentMetadata> {
  try {
    const agentsResult = await ctx.client.app?.agents?.()
    const agentsRaw = isObject(agentsResult) ? agentsResult["data"] : undefined
    const agents = Array.isArray(agentsRaw) ? agentsRaw.map(toAgentInfo).filter(Boolean) : []

    const matched = agents.find(
      (agent) => agent?.name?.toLowerCase() === MULTIMODAL_LOOKER_AGENT.toLowerCase()
    )

    return {
      agentModel: matched?.model,
      agentVariant: matched?.variant,
    }
  } catch (error) {
    log("[look_at] Failed to resolve multimodal-looker model info", error)
    return {}
  }
}

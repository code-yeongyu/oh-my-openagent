import type { OhMyOpenCodeConfig } from "../../config"
import { resolveAgentVariant } from "../../shared/agent-variant"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"

export type RuntimeModelSettings = {
  reasoning?: string
  reasoningEffort?: string
}

export function resolveRuntimeModelSettings(
  sessionID: string,
  agent: string | undefined,
  pluginConfig: OhMyOpenCodeConfig | undefined,
): RuntimeModelSettings {
  if (!pluginConfig) return {}

  const registeredCategoryName = SessionCategoryRegistry.get(sessionID)
  const registeredCategory = registeredCategoryName
    ? pluginConfig.categories?.[registeredCategoryName]
    : undefined
  const agentConfig = agent
    ? pluginConfig.agents?.[agent as keyof typeof pluginConfig.agents]
    : undefined
  const agentCategory = typeof agentConfig?.category === "string"
    ? pluginConfig.categories?.[agentConfig.category]
    : undefined
  const reasoning = registeredCategory?.reasoning
    ?? registeredCategory?.variant
    ?? (agent ? resolveAgentVariant(pluginConfig, agent) : undefined)
  const reasoningEffort = registeredCategory?.reasoningEffort
    ?? agentConfig?.reasoningEffort
    ?? agentCategory?.reasoningEffort

  return {
    ...(reasoning !== undefined ? { reasoning } : {}),
    ...(reasoningEffort !== undefined ? { reasoningEffort } : {}),
  }
}

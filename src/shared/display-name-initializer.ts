import type { OhMyOpenCodeConfig } from "../config"
import { setAgentDisplayNameOverrides } from "./agent-display-names"
import { setCategoryDisplayNameOverrides } from "./category-display-names"

/**
 * Extract display_name overrides from plugin config and apply them
 * to the agent and category display name systems.
 * Must be called after loadPluginConfig() during plugin initialization.
 */
export function initDisplayNameOverrides(pluginConfig: OhMyOpenCodeConfig): void {
  const agentOverrides: Record<string, string> = {}
  if (pluginConfig.agents) {
    for (const [agentKey, agentConfig] of Object.entries(pluginConfig.agents)) {
      if (agentConfig?.display_name) {
        agentOverrides[agentKey] = agentConfig.display_name
      }
    }
  }
  setAgentDisplayNameOverrides(agentOverrides)

  const categoryOverrides: Record<string, string> = {}
  if (pluginConfig.categories) {
    for (const [categoryKey, categoryConfig] of Object.entries(pluginConfig.categories)) {
      if (categoryConfig?.display_name) {
        categoryOverrides[categoryKey] = categoryConfig.display_name
      }
    }
  }
  setCategoryDisplayNameOverrides(categoryOverrides)
}

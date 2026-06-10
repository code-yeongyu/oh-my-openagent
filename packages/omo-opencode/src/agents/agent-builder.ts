import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentFactory } from "./types"
import type { CategoriesConfig, CategoryConfig } from "../config/schema"
import { mergeCategories } from "../shared/merge-categories"

export type AgentSource = AgentFactory | AgentConfig

export function isFactory(source: AgentSource): source is AgentFactory {
  return typeof source === "function"
}

export function buildAgent(
  source: AgentSource,
  model: string,
  categories?: CategoriesConfig
): AgentConfig {
  const base = isFactory(source) ? source(model) : { ...source }
  const categoryConfigs: Record<string, CategoryConfig> = mergeCategories(categories)

  const agentWithCategory = base as AgentConfig & { category?: string; skills?: string[]; variant?: string }
  if (agentWithCategory.category) {
    const categoryConfig = categoryConfigs[agentWithCategory.category]
    if (categoryConfig) {
      if (!base.model) {
        base.model = categoryConfig.model
      }
      if (base.temperature === undefined && categoryConfig.temperature !== undefined) {
        base.temperature = categoryConfig.temperature
      }
      if (base.variant === undefined && categoryConfig.variant !== undefined) {
        base.variant = categoryConfig.variant
      }
    }
  }

  if (isFactory(source) && (base as AgentConfig & { mode?: string }).mode === undefined) {
    ;(base as AgentConfig & { mode?: string }).mode = source.mode
  }

  return base
}

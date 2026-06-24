import { getModelResolutionInfoWithOverrides } from "../../cli/doctor/checks/model-resolution"
import type { OmoConfig } from "../../cli/doctor/checks/model-resolution-types"
import type { OhMyOpenCodeConfig } from "../../config"
import { validatePluginConfig } from "../../config/validate"
import type { RosterRow } from "./state-types"

type ResolutionEntry = {
  readonly name: string
  readonly effectiveModel: string
}

type AgentModelConfig = {
  model?: string
  variant?: string
  category?: string
}

type CategoryModelConfig = {
  model?: string
  variant?: string
}

function formatModelLabel(model: string): string {
  const slashIndex = model.lastIndexOf("/")
  if (slashIndex < 0 || slashIndex === model.length - 1) {
    return model
  }
  return model.slice(slashIndex + 1)
}

function toRosterRow(entry: ResolutionEntry): RosterRow {
  return {
    label: entry.name,
    model: formatModelLabel(entry.effectiveModel),
  }
}

function pickAgentModelConfig(agent: AgentModelConfig): AgentModelConfig {
  const picked: AgentModelConfig = {}
  if (agent.model !== undefined) picked.model = agent.model
  if (agent.variant !== undefined) picked.variant = agent.variant
  if (agent.category !== undefined) picked.category = agent.category
  return picked
}

function pickCategoryModelConfig(category: CategoryModelConfig): CategoryModelConfig {
  const picked: CategoryModelConfig = {}
  if (category.model !== undefined) picked.model = category.model
  if (category.variant !== undefined) picked.variant = category.variant
  return picked
}

function toModelResolutionConfig(config: OhMyOpenCodeConfig): OmoConfig {
  const agents: Record<string, AgentModelConfig> = {}
  const categories: Record<string, CategoryModelConfig> = {}

  for (const [name, agent] of Object.entries(config.agents ?? {})) {
    if (agent) agents[name] = pickAgentModelConfig(agent)
  }

  for (const [name, category] of Object.entries(config.categories ?? {})) {
    if (category) categories[name] = pickCategoryModelConfig(category)
  }

  return { agents, categories }
}

export function resolveRoster(directory: string): RosterRow[] {
  try {
    const config = validatePluginConfig(directory).config
    const resolution = getModelResolutionInfoWithOverrides(toModelResolutionConfig(config))
    return [...resolution.agents, ...resolution.categories]
      .map(toRosterRow)
      .sort((left, right) => left.label.localeCompare(right.label))
  } catch (error) {
    if (error instanceof Error) {
      return []
    }
    throw error
  }
}

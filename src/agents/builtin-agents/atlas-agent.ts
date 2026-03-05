import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoriesConfig, CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution } from "./model-resolution"
import { createAtlasAgent } from "../atlas"

export function maybeCreateAtlasConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  uiSelectedModel?: string
  availableModels: Set<string>
  systemDefaultModel?: string
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  userCategories?: CategoriesConfig
  useTaskSystem?: boolean
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    availableAgents,
    availableSkills,
    mergedCategories,
    directory,
    userCategories,
  } = input

  if (disabledAgents.includes("atlas")) return undefined

  const orchestratorOverride = agentOverrides["atlas"]
  const atlasRequirement = AGENT_MODEL_REQUIREMENTS["atlas"]

  const atlasResolution = applyModelResolution({
    uiSelectedModel: orchestratorOverride?.model ? undefined : uiSelectedModel,
    userModel: orchestratorOverride?.model,
    requirement: atlasRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (!atlasResolution) return undefined
  const { model: atlasModel, variant: atlasResolvedVariant } = atlasResolution

  let orchestratorConfig = createAtlasAgent({
    model: atlasModel,
    availableAgents,
    availableSkills,
    userCategories,
  })

  if (atlasResolvedVariant) {
    orchestratorConfig = { ...orchestratorConfig, variant: atlasResolvedVariant }
  }

  orchestratorConfig = applyOverrides(orchestratorConfig, orchestratorOverride, mergedCategories, directory)

  return orchestratorConfig
}

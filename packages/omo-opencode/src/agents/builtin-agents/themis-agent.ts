import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyProviderConnected } from "../../shared"
import { createThemisAgent } from "../themis"
import { applyEnvironmentContext } from "./environment-context"
import { applyCategoryOverride, mergeAgentConfig } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"

export function maybeCreateThemisConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  availableModels: Set<string>
  systemDefaultModel?: string
  isFirstRunNoCache: boolean
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  useTaskSystem: boolean
  disableOmoEnv?: boolean
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents: _availableAgents,
    availableSkills: _availableSkills,
    availableCategories: _availableCategories,
    mergedCategories,
    directory,
    useTaskSystem: _useTaskSystem,
    disableOmoEnv = false,
  } = input

  if (disabledAgents.includes("themis")) return undefined

  const themisOverride = agentOverrides["themis"]
  const themisRequirement = AGENT_MODEL_REQUIREMENTS["themis"]
  const hasThemisExplicitConfig = themisOverride !== undefined

  const hasRequiredProvider =
    !themisRequirement?.requiresProvider ||
    hasThemisExplicitConfig ||
    isFirstRunNoCache ||
    isAnyProviderConnected(themisRequirement.requiresProvider, availableModels)

  if (!hasRequiredProvider) return undefined

  let themisResolution = applyModelResolution({
    requirement: themisRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache) {
    themisResolution = getFirstFallbackModel(themisRequirement)
  }

  if (!themisResolution) return undefined
  const { model: themisModel, variant: themisResolvedVariant } = themisResolution

  let themisConfig = createThemisAgent(themisModel)

  if (themisResolvedVariant) {
    themisConfig = { ...themisConfig, variant: themisResolvedVariant }
  }

  const themisOverrideCategory = (themisOverride as Record<string, unknown> | undefined)?.category as string | undefined
  if (themisOverrideCategory) {
    themisConfig = applyCategoryOverride(themisConfig, themisOverrideCategory, mergedCategories)
  }

  themisConfig = applyEnvironmentContext(themisConfig, directory, { disableOmoEnv })

  if (themisOverride) {
    themisConfig = mergeAgentConfig(themisConfig, themisOverride, directory)
  }
  return themisConfig
}

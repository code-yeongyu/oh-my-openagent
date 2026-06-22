import type { AgentConfig } from "@opencode-ai/sdk"
import type { CategoriesConfig, CategoryConfig } from "../../config/schema"
import { AGENT_MODEL_REQUIREMENTS, isAnyFallbackModelAvailable } from "../../shared"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { createMorpheusAgent } from "../morpheus"
import type { AgentOverrides } from "../types"
import { applyOverrides } from "./agent-overrides"
import { applyEnvironmentContext } from "./environment-context"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"

export function maybeCreateMorpheusConfig(input: {
  disabledAgents: string[]
  agentOverrides: AgentOverrides
  uiSelectedModel?: string
  availableModels: Set<string>
  systemDefaultModel?: string
  isFirstRunNoCache: boolean
  availableAgents: AvailableAgent[]
  availableSkills: AvailableSkill[]
  availableCategories: AvailableCategory[]
  mergedCategories: Record<string, CategoryConfig>
  directory?: string
  userCategories?: CategoriesConfig
  useTaskSystem: boolean
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
    uiSelectedModel,
    availableModels,
    systemDefaultModel,
    isFirstRunNoCache,
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    useTaskSystem,
  } = input

  const morpheusOverride = agentOverrides.morpheus
  const sisyphusRequirement = AGENT_MODEL_REQUIREMENTS.morpheus
  const hasMorpheusExplicitConfig = morpheusOverride !== undefined
  const meetsMorpheusAnyModelRequirement =
    !sisyphusRequirement?.requiresAnyModel ||
    hasMorpheusExplicitConfig ||
    isFirstRunNoCache ||
    isAnyFallbackModelAvailable(sisyphusRequirement.fallbackChain, availableModels)

  if (disabledAgents.includes("morpheus") || !meetsMorpheusAnyModelRequirement) return undefined

  let sisyphusResolution = applyModelResolution({
    uiSelectedModel: morpheusOverride?.model ? undefined : uiSelectedModel,
    userModel: morpheusOverride?.model,
    requirement: sisyphusRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !morpheusOverride?.model && !uiSelectedModel) {
    sisyphusResolution = getFirstFallbackModel(sisyphusRequirement)
  }

  if (!sisyphusResolution) return undefined
  const { model: sisyphusModel, variant: morpheusResolvedVariant } = sisyphusResolution

  let morpheusConfig = createMorpheusAgent(
    sisyphusModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem
  )

  if (morpheusResolvedVariant) {
    morpheusConfig = { ...morpheusConfig, variant: morpheusResolvedVariant }
  }

  morpheusConfig = applyOverrides(morpheusConfig, morpheusOverride, mergedCategories)
  morpheusConfig = applyEnvironmentContext(morpheusConfig, directory)

  return morpheusConfig
}

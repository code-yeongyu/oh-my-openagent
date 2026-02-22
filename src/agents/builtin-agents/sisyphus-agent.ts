import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoriesConfig, CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyFallbackModelAvailable } from "../../shared"
import { applyEnvironmentContext } from "./environment-context"
import { applyOverrides } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"
import { createSisyphusAgent } from "../sisyphus"

export function maybeCreateSisyphusConfig(input: {
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

  const sisyphusOverride = agentOverrides["sisyphus"]
  const sisyphusRequirement = AGENT_MODEL_REQUIREMENTS["sisyphus"]
  const hasSisyphusExplicitConfig = sisyphusOverride !== undefined
  const meetsSisyphusAnyModelRequirement =
    !sisyphusRequirement?.requiresAnyModel ||
    hasSisyphusExplicitConfig ||
    isFirstRunNoCache ||
    isAnyFallbackModelAvailable(sisyphusRequirement.fallbackChain, availableModels)

  if (disabledAgents.includes("sisyphus") || !meetsSisyphusAnyModelRequirement) return undefined

  let sisyphusResolution = applyModelResolution({
    uiSelectedModel: sisyphusOverride?.model ? undefined : uiSelectedModel,
    userModel: sisyphusOverride?.model,
    requirement: sisyphusRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !sisyphusOverride?.model && !uiSelectedModel) {
    sisyphusResolution = getFirstFallbackModel(sisyphusRequirement)
  }

  if (!sisyphusResolution) return undefined
  const { model: sisyphusModel, variant: sisyphusResolvedVariant } = sisyphusResolution

  let sisyphusConfig = createSisyphusAgent(
    sisyphusModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem
  )

  if (sisyphusResolvedVariant) {
    sisyphusConfig = { ...sisyphusConfig, variant: sisyphusResolvedVariant }
  }

  sisyphusConfig = applyOverrides(sisyphusConfig, sisyphusOverride, mergedCategories, directory)
  sisyphusConfig = applyEnvironmentContext(sisyphusConfig, directory)

  return sisyphusConfig
}

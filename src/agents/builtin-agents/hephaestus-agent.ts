import type { AgentConfig } from "@opencode-ai/sdk"
import type { CategoryConfig } from "../../config/schema"
import { AGENT_MODEL_REQUIREMENTS, isAnyProviderConnected } from "../../shared"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { createEnvContext } from "../env-context"
import { createKeymakerAgent } from "../keymaker"
import type { AgentOverrides } from "../types"
import { applyCategoryOverride, mergeAgentConfig } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"

export function maybeCreateKeymakerConfig(input: {
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
}): AgentConfig | undefined {
  const {
    disabledAgents,
    agentOverrides,
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

  if (disabledAgents.includes("keymaker")) return undefined

  const keymakerOverride = agentOverrides["keymaker"]
  const hephaestusRequirement = AGENT_MODEL_REQUIREMENTS["keymaker"]
  const hasKeymakerExplicitConfig = keymakerOverride !== undefined

  const hasRequiredProvider =
    !hephaestusRequirement?.requiresProvider ||
    hasKeymakerExplicitConfig ||
    isFirstRunNoCache ||
    isAnyProviderConnected(hephaestusRequirement.requiresProvider, availableModels)

  if (!hasRequiredProvider) return undefined

  let hephaestusResolution = applyModelResolution({
    userModel: keymakerOverride?.model,
    requirement: hephaestusRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !keymakerOverride?.model) {
    hephaestusResolution = getFirstFallbackModel(hephaestusRequirement)
  }

  if (!hephaestusResolution) return undefined
  const { model: hephaestusModel, variant: hephaestusResolvedVariant } = hephaestusResolution

  let keymakerConfig = createKeymakerAgent(
    hephaestusModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem
  )

  keymakerConfig = { ...keymakerConfig, variant: hephaestusResolvedVariant ?? "medium" }

  const hepOverrideCategory = (keymakerOverride as Record<string, unknown> | undefined)?.category as string | undefined
  if (hepOverrideCategory) {
    keymakerConfig = applyCategoryOverride(keymakerConfig, hepOverrideCategory, mergedCategories)
  }

  if (directory && keymakerConfig.prompt) {
    const envContext = createEnvContext()
    keymakerConfig = { ...keymakerConfig, prompt: keymakerConfig.prompt + envContext }
  }

  if (keymakerOverride) {
    keymakerConfig = mergeAgentConfig(keymakerConfig, keymakerOverride)
  }
  return keymakerConfig
}

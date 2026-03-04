import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared"
import { createCerberusAgent } from "../cerberus"
import { applyEnvironmentContext } from "./environment-context"
import { applyCategoryOverride, mergeAgentConfig } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"

export function maybeCreateCerberusConfig(input: {
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
    availableAgents,
    availableSkills,
    availableCategories,
    mergedCategories,
    directory,
    useTaskSystem,
    disableOmoEnv = false,
  } = input

  if (disabledAgents.includes("cerberus")) return undefined

  const cerberusOverride = agentOverrides["cerberus"]
  const cerberusRequirement = AGENT_MODEL_REQUIREMENTS["cerberus"]

  let cerberusResolution = applyModelResolution({
    userModel: cerberusOverride?.model,
    requirement: cerberusRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !cerberusOverride?.model) {
    cerberusResolution = getFirstFallbackModel(cerberusRequirement)
  }

  if (!cerberusResolution) return undefined
  const { model: cerberusModel, variant: cerberusResolvedVariant } = cerberusResolution

  let cerberusConfig = createCerberusAgent(
    cerberusModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem
  )

  cerberusConfig = { ...cerberusConfig, variant: cerberusResolvedVariant ?? "medium" }

  const cerbOverrideCategory = (cerberusOverride as Record<string, unknown> | undefined)?.category as string | undefined
  if (cerbOverrideCategory) {
    cerberusConfig = applyCategoryOverride(cerberusConfig, cerbOverrideCategory, mergedCategories)
  }

  cerberusConfig = applyEnvironmentContext(cerberusConfig, directory, { disableOmoEnv })

  if (cerberusOverride) {
    cerberusConfig = mergeAgentConfig(cerberusConfig, cerberusOverride, directory)
  }
  return cerberusConfig
}

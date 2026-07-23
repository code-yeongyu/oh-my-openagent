import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrides } from "../types"
import type { CategoryConfig } from "../../config/schema"
import type { AvailableAgent, AvailableCategory, AvailableSkill } from "../dynamic-agent-prompt-builder"
import { AGENT_MODEL_REQUIREMENTS, isAnyProviderConnected } from "../../shared"
import { log } from "../../shared/logger"
import { createHephaestusAgent, isHephaestusSupportedModel } from "../hephaestus"
import { applyEnvironmentContext } from "./environment-context"
import { applyCategoryOverride, mergeAgentConfig } from "./agent-overrides"
import { applyModelResolution, getFirstFallbackModel } from "./model-resolution"
import { applyFrontierToolSchemaPermission } from "../frontier-tool-schema-guard"

export function maybeCreateHephaestusConfig(input: {
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

  if (disabledAgents.includes("hephaestus")) return undefined

  const hephaestusOverride = agentOverrides["hephaestus"]
  const hephaestusRequirement = AGENT_MODEL_REQUIREMENTS["hephaestus"]
  const hasHephaestusExplicitConfig = hephaestusOverride !== undefined
  const allowNonGptModel = hephaestusOverride?.allow_non_gpt_model === true

  const isUnsupportedHephaestusModel = (model: string | undefined) =>
    !allowNonGptModel && !isHephaestusSupportedModel(model)

  const hasRequiredProvider =
    !hephaestusRequirement?.requiresProvider ||
    hasHephaestusExplicitConfig ||
    isFirstRunNoCache ||
    isAnyProviderConnected(hephaestusRequirement.requiresProvider, availableModels)

  if (!hasRequiredProvider) {
    log("[agent-registration] Agent skipped: required provider not connected", {
      agent: "hephaestus",
      requiredProvider: hephaestusRequirement?.requiresProvider,
    })
    return undefined
  }

  let hephaestusResolution = applyModelResolution({
    userModel: hephaestusOverride?.model,
    requirement: hephaestusRequirement,
    availableModels,
    systemDefaultModel,
  })

  if (isFirstRunNoCache && !hephaestusOverride?.model) {
    hephaestusResolution = getFirstFallbackModel(hephaestusRequirement)
  }

  if (!hephaestusResolution) {
    log("[agent-registration] Agent skipped: model resolution returned no result", {
      agent: "hephaestus",
      configuredModel: hephaestusOverride?.model,
    })
    return undefined
  }
  const { model: hephaestusModel, variant: hephaestusResolvedVariant } = hephaestusResolution

  if (isUnsupportedHephaestusModel(hephaestusModel)) {
    log("[agent-registration] Agent skipped: unsupported Hephaestus model", {
      agent: "hephaestus",
      configuredModel: hephaestusModel,
    })
    return undefined
  }

  let hephaestusConfig = createHephaestusAgent(
    hephaestusModel,
    availableAgents,
    undefined,
    availableSkills,
    availableCategories,
    useTaskSystem,
    allowNonGptModel
  )

  hephaestusConfig = { ...hephaestusConfig, variant: hephaestusResolvedVariant ?? "medium" }

  const hepOverrideCategory = (hephaestusOverride as Record<string, unknown> | undefined)?.category as string | undefined
  if (hepOverrideCategory) {
    hephaestusConfig = applyCategoryOverride(hephaestusConfig, hepOverrideCategory, mergedCategories)
    if (isUnsupportedHephaestusModel(hephaestusConfig.model)) {
      log("[agent-registration] Agent skipped: unsupported Hephaestus category model", {
        agent: "hephaestus",
        configuredModel: hephaestusConfig.model,
      })
      return undefined
    }
  }

  hephaestusConfig = applyEnvironmentContext(hephaestusConfig, directory, { disableOmoEnv })

  if (hephaestusOverride) {
    hephaestusConfig = mergeAgentConfig(hephaestusConfig, hephaestusOverride, directory)
    if (isUnsupportedHephaestusModel(hephaestusConfig.model)) {
      log("[agent-registration] Agent skipped: unsupported Hephaestus override model", {
        agent: "hephaestus",
        configuredModel: hephaestusConfig.model,
      })
      return undefined
    }
  }

  const resolvedModel = hephaestusConfig.model ?? ""
  hephaestusConfig.permission = applyFrontierToolSchemaPermission(
    hephaestusConfig.permission,
    resolvedModel,
    hephaestusOverride?.permission,
    (hephaestusOverride as { tools?: Record<string, boolean> } | undefined)?.tools
  )

  return hephaestusConfig
}

import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "../../../shared/model-requirements"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import type { CheckResult, DoctorIssue } from "../types"
import { loadAvailableModelsFromCache } from "./model-resolution-cache"
import { loadOmoConfig } from "./model-resolution-config"
import { buildModelResolutionDetails } from "./model-resolution-details"
import { buildEffectiveResolution, getEffectiveModel } from "./model-resolution-effective-model"
import type { AgentResolutionInfo, CategoryResolutionInfo, ModelResolutionInfo, OmoConfig } from "./model-resolution-types"

export function getModelResolutionInfo(): ModelResolutionInfo {
  const agents: AgentResolutionInfo[] = Object.entries(AGENT_MODEL_REQUIREMENTS).map(([name, requirement]) => ({
    name,
    requirement,
    effectiveModel: getEffectiveModel(requirement),
    effectiveResolution: buildEffectiveResolution(requirement),
  }))

  const categories: CategoryResolutionInfo[] = Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => ({
      name,
      requirement,
      effectiveModel: getEffectiveModel(requirement),
      effectiveResolution: buildEffectiveResolution(requirement),
    })
  )

  return { agents, categories }
}

export function getModelResolutionInfoWithOverrides(config: OmoConfig): ModelResolutionInfo {
  const agents: AgentResolutionInfo[] = Object.entries(AGENT_MODEL_REQUIREMENTS).map(([name, requirement]) => {
    const userOverride = config.agents?.[name]?.model
    const userVariant = config.agents?.[name]?.variant
    return {
      name,
      requirement,
      userOverride,
      userVariant,
      effectiveModel: getEffectiveModel(requirement, userOverride),
      effectiveResolution: buildEffectiveResolution(requirement, userOverride),
    }
  })

  const categories: CategoryResolutionInfo[] = Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => {
      const userOverride = config.categories?.[name]?.model
      const userVariant = config.categories?.[name]?.variant
      return {
        name,
        requirement,
        userOverride,
        userVariant,
        effectiveModel: getEffectiveModel(requirement, userOverride),
        effectiveResolution: buildEffectiveResolution(requirement, userOverride),
      }
    }
  )

  return { agents, categories }
}

export async function checkModels(): Promise<CheckResult> {
  const config = loadOmoConfig() ?? {}
  const info = getModelResolutionInfoWithOverrides(config)
  const available = loadAvailableModelsFromCache()
  const issues: DoctorIssue[] = []

  if (!available.cacheExists) {
    issues.push({
      title: "Model cache not found",
      description: "OpenCode model cache is missing, so model availability cannot be validated.",
      fix: "Run: opencode models --refresh",
      severity: "warning",
      affects: ["model resolution"],
    })
  }

  const overrideCount =
    info.agents.filter((agent) => Boolean(agent.userOverride)).length +
    info.categories.filter((category) => Boolean(category.userOverride)).length

  return {
    name: CHECK_NAMES[CHECK_IDS.MODELS],
    status: issues.length > 0 ? "warn" : "pass",
    message: `${info.agents.length} agents, ${info.categories.length} categories, ${overrideCount} override${overrideCount === 1 ? "" : "s"}`,
    details: buildModelResolutionDetails({ info, available, config }),
    issues,
  }
}

export const checkModelResolution = checkModels

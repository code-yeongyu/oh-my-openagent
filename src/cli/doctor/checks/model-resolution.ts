import type { CheckResult, CheckDefinition } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
} from "../../../shared/model-requirements"
import type { OmoConfig, ModelResolutionInfo, AgentResolutionInfo, CategoryResolutionInfo } from "./model-resolution-types"
import { loadAvailableModelsFromCache } from "./model-resolution-cache"
import { loadOmoConfig } from "./model-resolution-config"
import { buildEffectiveResolution, getEffectiveModel } from "./model-resolution-effective-model"
import { buildModelResolutionDetails } from "./model-resolution-details"

export function getModelResolutionInfo(): ModelResolutionInfo {
  const agents: AgentResolutionInfo[] = Object.entries(AGENT_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => ({
      name,
      requirement,
      effectiveModel: getEffectiveModel(requirement),
      effectiveResolution: buildEffectiveResolution(requirement),
    }),
  )

  const categories: CategoryResolutionInfo[] = Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => ({
      name,
      requirement,
      effectiveModel: getEffectiveModel(requirement),
      effectiveResolution: buildEffectiveResolution(requirement),
    }),
  )

  return { agents, categories }
}

export function getModelResolutionInfoWithOverrides(config: OmoConfig): ModelResolutionInfo {
  const agents: AgentResolutionInfo[] = Object.entries(AGENT_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => {
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
    },
  )

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
    },
  )

  return { agents, categories }
}

export async function checkModelResolution(): Promise<CheckResult> {
  const config = loadOmoConfig() ?? {}
  const info = getModelResolutionInfoWithOverrides(config)
  const available = loadAvailableModelsFromCache()

  const agentCount = info.agents.length
  const categoryCount = info.categories.length
  const agentOverrides = info.agents.filter((a) => a.userOverride).length
  const categoryOverrides = info.categories.filter((c) => c.userOverride).length
  const totalOverrides = agentOverrides + categoryOverrides

  const overrideNote = totalOverrides > 0 ? ` (${totalOverrides} override${totalOverrides > 1 ? "s" : ""})` : ""
  const cacheNote = available.cacheExists ? `, ${available.modelCount} available` : ", cache not found"

  return {
    name: CHECK_NAMES[CHECK_IDS.MODEL_RESOLUTION],
    status: available.cacheExists ? "pass" : "warn",
    message: `${agentCount} agents, ${categoryCount} categories${overrideNote}${cacheNote}`,
    details: buildModelResolutionDetails({ info, available, config }),
  }
}

export function getModelResolutionCheckDefinition(): CheckDefinition {
  return {
    id: CHECK_IDS.MODEL_RESOLUTION,
    name: CHECK_NAMES[CHECK_IDS.MODEL_RESOLUTION],
    category: "configuration",
    check: checkModelResolution,
    critical: false,
  }
}

import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "../../../shared/model-requirements"
import { getModelCapabilities } from "../../../shared/model-capabilities"
import { CHECK_IDS, CHECK_NAMES } from "../framework/constants"
import type { CheckResult, DoctorIssue } from "../framework/types"
import { loadAvailableModelsFromCache } from "./model-resolution-cache"
import { loadOmoConfig } from "./model-resolution-config"
import { resolveConfiguredCategoriesAtRuntime } from "./model-resolution-runtime-category"
import { buildModelResolutionDetails } from "./model-resolution-details"
import { buildEffectiveResolution, getEffectiveModel } from "./model-resolution-effective-model"
import type {
  AgentResolutionInfo,
  CategoryResolutionInfo,
  ModelResolutionInfo,
  OmoConfig,
  RuntimeCategoryResolution,
} from "./model-resolution-types"

export function parseProviderModel(value: string): { providerID: string; modelID: string } | null {
  const slashIndex = value.indexOf("/")
  if (slashIndex <= 0 || slashIndex === value.length - 1) {
    return null
  }

  return {
    providerID: value.slice(0, slashIndex),
    modelID: value.slice(slashIndex + 1),
  }
}

function attachCapabilityDiagnostics<T extends AgentResolutionInfo | CategoryResolutionInfo>(entry: T): T {
  const parsed = parseProviderModel(entry.effectiveModel)
  if (!parsed) {
    return entry
  }

  return {
    ...entry,
    capabilityDiagnostics: getModelCapabilities({
      providerID: parsed.providerID,
      modelID: parsed.modelID,
    }).diagnostics,
  }
}

export function getModelResolutionInfo(): ModelResolutionInfo {
  const agents: AgentResolutionInfo[] = Object.entries(AGENT_MODEL_REQUIREMENTS).map(([name, requirement]) =>
    attachCapabilityDiagnostics({
      name,
      requirement,
      effectiveModel: getEffectiveModel(requirement),
      effectiveResolution: buildEffectiveResolution(requirement),
    })
  )

  const categories: CategoryResolutionInfo[] = Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(
    ([name, requirement]) =>
      attachCapabilityDiagnostics({
        name,
        requirement,
        effectiveModel: getEffectiveModel(requirement),
        effectiveResolution: buildEffectiveResolution(requirement),
      })
  )

  return { agents, categories }
}

export function getModelResolutionInfoWithOverrides(
  config: OmoConfig,
  runtimeCategories: Record<string, RuntimeCategoryResolution> = {},
): ModelResolutionInfo {
  const agents: AgentResolutionInfo[] = Object.entries(AGENT_MODEL_REQUIREMENTS).map(([name, requirement]) => {
    const userOverride = config.agents?.[name]?.model
    const userVariant = config.agents?.[name]?.variant
    return attachCapabilityDiagnostics({
      name,
      requirement,
      userOverride,
      userVariant,
      effectiveModel: getEffectiveModel(requirement, userOverride),
      effectiveResolution: buildEffectiveResolution(requirement, userOverride),
    })
  })

  const categories: CategoryResolutionInfo[] = Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => {
      const runtime = runtimeCategories[name]
      if (runtime?.disabled === true || config.categories?.[name]?.disable === true) {
        return {
          name,
          requirement,
          effectiveModel: getEffectiveModel(requirement),
          effectiveResolution: "Disabled",
          disabled: true,
        }
      }
      if (runtime?.error !== undefined) {
        return attachCapabilityDiagnostics({
          name,
          requirement,
          effectiveModel: getEffectiveModel(requirement),
          effectiveResolution: `Runtime error: ${runtime.error}`,
          runtimeError: runtime.error,
        })
      }
      const runtimeModel = runtime?.model
      const runtimeResolved = runtimeModel !== undefined
      const userOverride = runtime === undefined
        ? config.categories?.[name]?.model
        : runtime.userDefined ? runtime.model : undefined
      const userVariant = runtime === undefined ? config.categories?.[name]?.variant : runtime.reasoning
      return attachCapabilityDiagnostics({
        name,
        requirement,
        userOverride,
        userVariant,
        effectiveModel: runtimeModel ?? getEffectiveModel(requirement, userOverride),
        effectiveResolution: buildEffectiveResolution(requirement, userOverride),
        ...(runtimeResolved ? { runtimeResolved } : {}),
      })
    }
  )

  return { agents, categories }
}

export function collectCapabilityResolutionIssues(info: ModelResolutionInfo): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const allEntries = [...info.agents, ...info.categories]
  const fallbackEntries = allEntries.filter((entry) => {
    const mode = entry.capabilityDiagnostics?.resolutionMode
    return mode === "unknown"
  })

  if (fallbackEntries.length === 0) {
    return issues
  }

  const summary = fallbackEntries
    .map((entry) => `${entry.name}=${entry.effectiveModel} (${entry.capabilityDiagnostics?.resolutionMode ?? "unknown"})`)
    .join(", ")

  issues.push({
    title: "Configured models rely on compatibility fallback",
    description: summary,
    severity: "warning",
    affects: fallbackEntries.map((entry) => entry.name),
  })

  return issues
}

export async function checkModels(): Promise<CheckResult> {
  const config = loadOmoConfig()
  const info = getModelResolutionInfoWithOverrides(config, await resolveConfiguredCategoriesAtRuntime(config))
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

  issues.push(...collectCapabilityResolutionIssues(info))
  const failedCategories = info.categories.filter((category) => category.runtimeError !== undefined)
  if (failedCategories.length > 0) {
    issues.push({
      title: "Configured categories fail to resolve at runtime",
      description: failedCategories.map((category) => `${category.name}: ${category.runtimeError}`).join("; "),
      severity: "warning",
      affects: failedCategories.map((category) => category.name),
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

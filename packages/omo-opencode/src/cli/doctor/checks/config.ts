import type { OhMyOpenCodeConfig } from "../../../config"
import { validatePluginConfig } from "../../../config/validate"
import { CHECK_IDS, CHECK_NAMES, PACKAGE_NAME } from "../framework/constants"
import type { CheckResult, DoctorIssue } from "../framework/types"
import { loadAvailableModelsFromCache } from "./model-resolution-cache"
import { getModelResolutionInfoWithOverrides } from "./model-resolution"
import type { OmoConfig } from "./model-resolution-types"

interface ConfigValidationResult {
  exists: boolean
  path: string | null
  valid: boolean
  config: OmoConfig | null
  errors: string[]
}

function toOmoConfig(config: OhMyOpenCodeConfig): OmoConfig {
  const agents: OmoConfig["agents"] = {}
  const categories: OmoConfig["categories"] = {}

  for (const [name, agent] of Object.entries(config.agents ?? {})) {
    if (!agent) continue
    const entry: NonNullable<OmoConfig["agents"]>[string] = {}
    if (agent.model !== undefined) entry.model = agent.model
    if (agent.variant !== undefined) entry.variant = agent.variant
    if (agent.category !== undefined) entry.category = agent.category
    agents[name] = entry
  }

  for (const [name, category] of Object.entries(config.categories ?? {})) {
    if (!category) continue
    const entry: NonNullable<OmoConfig["categories"]>[string] = {}
    if (category.model !== undefined) entry.model = category.model
    if (category.variant !== undefined) entry.variant = category.variant
    categories[name] = entry
  }

  return { agents, categories }
}

function validateConfig(): ConfigValidationResult {
  const validation = validatePluginConfig(process.cwd())
  if (!validation.path) {
    return { exists: false, path: null, valid: true, config: null, errors: [] }
  }

  return {
    exists: true,
    path: validation.path,
    valid: validation.valid,
    config: toOmoConfig(validation.config),
    errors: [...validation.messages],
  }
}

function collectModelResolutionIssues(config: OmoConfig): DoctorIssue[] {
  const issues: DoctorIssue[] = []
  const availableModels = loadAvailableModelsFromCache()
  const resolution = getModelResolutionInfoWithOverrides(config)

  const invalidAgentOverrides = resolution.agents.filter(
    (agent) => agent.userOverride && !agent.userOverride.includes("/")
  )
  const invalidCategoryOverrides = resolution.categories.filter(
    (category) => category.userOverride && !category.userOverride.includes("/")
  )

  for (const invalidAgent of invalidAgentOverrides) {
    issues.push({
      title: `Invalid agent override: ${invalidAgent.name}`,
      description: `Override '${invalidAgent.userOverride}' must be in provider/model format.`,
      severity: "warning",
      affects: [invalidAgent.name],
    })
  }

  for (const invalidCategory of invalidCategoryOverrides) {
    issues.push({
      title: `Invalid category override: ${invalidCategory.name}`,
      description: `Override '${invalidCategory.userOverride}' must be in provider/model format.`,
      severity: "warning",
      affects: [invalidCategory.name],
    })
  }

  if (availableModels.cacheExists) {
    const providerSet = new Set(availableModels.providers)
    const unknownProviders = [
      ...resolution.agents.map((agent) => agent.userOverride),
      ...resolution.categories.map((category) => category.userOverride),
    ]
      .filter((value): value is string => Boolean(value))
      .map((value) => value.split("/")[0])
      .filter((provider) => provider.length > 0 && !providerSet.has(provider))

    if (unknownProviders.length > 0) {
      const uniqueProviders = [...new Set(unknownProviders)]
      issues.push({
        title: "Model override uses unavailable provider",
        description: `Provider(s) not found in OpenCode model cache: ${uniqueProviders.join(", ")}`,
        severity: "warning",
        affects: ["model resolution"],
      })
    }
  }

  return issues
}

export async function checkConfig(): Promise<CheckResult> {
  const validation = validateConfig()
  const issues: DoctorIssue[] = []

  if (!validation.exists) {
    return {
      name: CHECK_NAMES[CHECK_IDS.CONFIG],
      status: "pass",
      message: "No custom config found; defaults are used",
      details: undefined,
      issues,
    }
  }

  if (!validation.valid) {
    issues.push(
      ...validation.errors.map((error) => ({
        title: "Invalid configuration",
        description: error,
        severity: "error" as const,
        affects: ["plugin startup"],
      }))
    )

    return {
      name: CHECK_NAMES[CHECK_IDS.CONFIG],
      status: "fail",
      message: `Configuration invalid (${issues.length} issue${issues.length > 1 ? "s" : ""})`,
      details: validation.path ? [`Path: ${validation.path}`] : undefined,
      issues,
    }
  }

  if (validation.config) {
    issues.push(...collectModelResolutionIssues(validation.config))
  }

  return {
    name: CHECK_NAMES[CHECK_IDS.CONFIG],
    status: issues.length > 0 ? "warn" : "pass",
    message: issues.length > 0 ? `${issues.length} configuration warning(s)` : "Configuration is valid",
    details: validation.path ? [`Path: ${validation.path}`] : undefined,
    issues,
  }
}

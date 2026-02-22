import { readFileSync } from "node:fs"
import { join } from "node:path"

import { OhMyOpenCodeConfigSchema } from "../../../config"
import { detectConfigFile, getOpenCodeConfigDir, parseJsonc } from "../../../shared"
import { CHECK_IDS, CHECK_NAMES, PACKAGE_NAME } from "../constants"
import type { CheckResult, DoctorIssue } from "../types"
import { loadAvailableModelsFromCache } from "./model-resolution-cache"
import { getModelResolutionInfoWithOverrides } from "./model-resolution"
import type { OmoConfig } from "./model-resolution-types"

const USER_CONFIG_BASE = join(getOpenCodeConfigDir({ binary: "opencode" }), PACKAGE_NAME)
const PROJECT_CONFIG_BASE = join(process.cwd(), ".opencode", PACKAGE_NAME)

interface ConfigValidationResult {
  exists: boolean
  path: string | null
  valid: boolean
  config: OmoConfig | null
  errors: string[]
}

function findConfigPath(): string | null {
  const projectConfig = detectConfigFile(PROJECT_CONFIG_BASE)
  if (projectConfig.format !== "none") return projectConfig.path

  const userConfig = detectConfigFile(USER_CONFIG_BASE)
  if (userConfig.format !== "none") return userConfig.path

  return null
}

function validateConfig(): ConfigValidationResult {
  const configPath = findConfigPath()
  if (!configPath) {
    return { exists: false, path: null, valid: true, config: null, errors: [] }
  }

  try {
    const content = readFileSync(configPath, "utf-8")
    const rawConfig = parseJsonc<OmoConfig>(content)
    const schemaResult = OhMyOpenCodeConfigSchema.safeParse(rawConfig)

    if (!schemaResult.success) {
      return {
        exists: true,
        path: configPath,
        valid: false,
        config: rawConfig,
        errors: schemaResult.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`),
      }
    }

    return { exists: true, path: configPath, valid: true, config: rawConfig, errors: [] }
  } catch (error) {
    return {
      exists: true,
      path: configPath,
      valid: false,
      config: null,
      errors: [error instanceof Error ? error.message : "Failed to parse config"],
    }
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

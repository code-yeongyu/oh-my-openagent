import { existsSync, readFileSync } from "node:fs"

import { AGENT_MODEL_REQUIREMENTS } from "../../../shared/model-requirements"
import { getOpenCodeConfigPaths, parseJsonc } from "../../../shared"
import { AUTH_ENV_VARS, AUTH_PLUGINS, CHECK_IDS, CHECK_NAMES } from "../constants"
import type { CheckResult, DoctorIssue, ProviderStatus } from "../types"

interface OpenCodeConfigShape {
  plugin?: string[]
}

function loadOpenCodePlugins(): string[] {
  const configPaths = getOpenCodeConfigPaths({ binary: "opencode", version: null })
  const targetPath = existsSync(configPaths.configJsonc)
    ? configPaths.configJsonc
    : configPaths.configJson

  if (!existsSync(targetPath)) return []

  try {
    const content = readFileSync(targetPath, "utf-8")
    const parsed = parseJsonc<OpenCodeConfigShape>(content)
    return parsed.plugin ?? []
  } catch {
    return []
  }
}

function hasProviderPlugin(plugins: string[], providerId: string): boolean {
  const definition = AUTH_PLUGINS[providerId]
  if (!definition) return false
  if (definition.plugin === "builtin") return true
  return plugins.some((plugin) => plugin === definition.plugin || plugin.startsWith(`${definition.plugin}@`))
}

function hasProviderEnvVar(providerId: string): boolean {
  const envVarNames = AUTH_ENV_VARS[providerId] ?? []
  return envVarNames.some((envVarName) => Boolean(process.env[envVarName]))
}

function getAffectedAgents(providerId: string): string[] {
  const affectedAgents: string[] = []

  for (const [agentName, requirement] of Object.entries(AGENT_MODEL_REQUIREMENTS)) {
    const usesProvider = requirement.fallbackChain.some((entry) => entry.providers.includes(providerId))
    if (usesProvider) {
      affectedAgents.push(agentName)
    }
  }

  return affectedAgents
}

export function gatherProviderStatuses(): ProviderStatus[] {
  const plugins = loadOpenCodePlugins()

  return Object.entries(AUTH_PLUGINS).map(([providerId, definition]) => {
    const hasPlugin = hasProviderPlugin(plugins, providerId)
    const hasEnvVar = hasProviderEnvVar(providerId)
    return {
      id: providerId,
      name: definition.name,
      available: hasPlugin && hasEnvVar,
      hasPlugin,
      hasEnvVar,
    }
  })
}

export async function checkProviders(): Promise<CheckResult> {
  const statuses = gatherProviderStatuses()
  const issues: DoctorIssue[] = []

  for (const status of statuses) {
    if (status.available) continue

    const missingParts: string[] = []
    if (!status.hasPlugin) missingParts.push("auth plugin")
    if (!status.hasEnvVar) missingParts.push("environment variable")

    issues.push({
      title: `${status.name} authentication missing`,
      description: `Missing ${missingParts.join(" and ")} for ${status.name}.`,
      fix: `Configure ${status.name} provider in OpenCode and set ${(AUTH_ENV_VARS[status.id] ?? []).join(" or ")}`,
      affects: getAffectedAgents(status.id),
      severity: "warning",
    })
  }

  const status = issues.length === 0 ? "pass" : "warn"
  return {
    name: CHECK_NAMES[CHECK_IDS.PROVIDERS],
    status,
    message: issues.length === 0 ? "All provider auth checks passed" : `${issues.length} provider issue(s) detected`,
    details: statuses.map(
      (providerStatus) =>
        `${providerStatus.name}: plugin=${providerStatus.hasPlugin ? "yes" : "no"}, env=${providerStatus.hasEnvVar ? "yes" : "no"}`
    ),
    issues,
  }
}

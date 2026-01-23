import { readFileSync } from "node:fs"
import type { CheckResult, CheckDefinition } from "../types"
import { CHECK_IDS, CHECK_NAMES } from "../constants"
import { parseJsonc, detectConfigFile } from "../../../shared"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type ModelRequirement,
} from "../../../shared/model-requirements"
import { homedir } from "node:os"
import { join } from "node:path"

const PACKAGE_NAME = "oh-my-opencode"
const USER_CONFIG_DIR = join(homedir(), ".config", "opencode")
const USER_CONFIG_BASE = join(USER_CONFIG_DIR, PACKAGE_NAME)
const PROJECT_CONFIG_BASE = join(process.cwd(), ".opencode", PACKAGE_NAME)

export interface AgentResolutionInfo {
  name: string
  requirement: ModelRequirement
  userOverride?: string
  effectiveModel: string
  effectiveResolution: string
}

export interface CategoryResolutionInfo {
  name: string
  requirement: ModelRequirement
  userOverride?: string
  effectiveModel: string
  effectiveResolution: string
}

export interface ModelResolutionInfo {
  agents: AgentResolutionInfo[]
  categories: CategoryResolutionInfo[]
}

interface OmoConfig {
  agents?: Record<string, { model?: string }>
  categories?: Record<string, { model?: string }>
}

function loadConfig(): OmoConfig | null {
  const projectDetected = detectConfigFile(PROJECT_CONFIG_BASE)
  if (projectDetected.format !== "none") {
    try {
      const content = readFileSync(projectDetected.path, "utf-8")
      return parseJsonc<OmoConfig>(content)
    } catch {
      return null
    }
  }

  const userDetected = detectConfigFile(USER_CONFIG_BASE)
  if (userDetected.format !== "none") {
    try {
      const content = readFileSync(userDetected.path, "utf-8")
      return parseJsonc<OmoConfig>(content)
    } catch {
      return null
    }
  }

  return null
}

function formatProviderChain(providers: string[]): string {
  return providers.join(" → ")
}

function getEffectiveModel(requirement: ModelRequirement, userOverride?: string): string {
  if (userOverride) {
    return userOverride
  }
  const firstEntry = requirement.fallbackChain[0]
  if (!firstEntry) {
    return "unknown"
  }
  return `${firstEntry.providers[0]}/${firstEntry.model}`
}

function buildEffectiveResolution(
  requirement: ModelRequirement,
  userOverride?: string,
): string {
  if (userOverride) {
    return `User override: ${userOverride}`
  }
  const firstEntry = requirement.fallbackChain[0]
  if (!firstEntry) {
    return "No fallback chain defined"
  }
  return `Provider fallback: ${formatProviderChain(firstEntry.providers)} → ${firstEntry.model}`
}

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
      return {
        name,
        requirement,
        userOverride,
        effectiveModel: getEffectiveModel(requirement, userOverride),
        effectiveResolution: buildEffectiveResolution(requirement, userOverride),
      }
    },
  )

  const categories: CategoryResolutionInfo[] = Object.entries(CATEGORY_MODEL_REQUIREMENTS).map(
    ([name, requirement]) => {
      const userOverride = config.categories?.[name]?.model
      return {
        name,
        requirement,
        userOverride,
        effectiveModel: getEffectiveModel(requirement, userOverride),
        effectiveResolution: buildEffectiveResolution(requirement, userOverride),
      }
    },
  )

  return { agents, categories }
}

function formatModelWithVariant(model: string, variant?: string): string {
  return variant ? `${model} (${variant})` : model
}

function getEffectiveVariant(requirement: ModelRequirement): string | undefined {
  const firstEntry = requirement.fallbackChain[0]
  return firstEntry?.variant ?? requirement.variant
}

function buildDetailsArray(info: ModelResolutionInfo): string[] {
  const details: string[] = []

  details.push("═══ Current Models ═══")
  details.push("")
  details.push("Agents:")
  for (const agent of info.agents) {
    const marker = agent.userOverride ? "●" : "○"
    const display = formatModelWithVariant(agent.effectiveModel, getEffectiveVariant(agent.requirement))
    details.push(`  ${marker} ${agent.name}: ${display}`)
  }
  details.push("")
  details.push("Categories:")
  for (const category of info.categories) {
    const marker = category.userOverride ? "●" : "○"
    const display = formatModelWithVariant(category.effectiveModel, getEffectiveVariant(category.requirement))
    details.push(`  ${marker} ${category.name}: ${display}`)
  }
  details.push("")
  details.push("● = user override, ○ = provider fallback")

  return details
}

export async function checkModelResolution(): Promise<CheckResult> {
  const config = loadConfig() ?? {}
  const info = getModelResolutionInfoWithOverrides(config)

  const agentCount = info.agents.length
  const categoryCount = info.categories.length
  const agentOverrides = info.agents.filter((a) => a.userOverride).length
  const categoryOverrides = info.categories.filter((c) => c.userOverride).length
  const totalOverrides = agentOverrides + categoryOverrides

  const overrideNote = totalOverrides > 0 ? ` (${totalOverrides} override${totalOverrides > 1 ? "s" : ""})` : ""

  return {
    name: CHECK_NAMES[CHECK_IDS.MODEL_RESOLUTION],
    status: "pass",
    message: `${agentCount} agents, ${categoryCount} categories${overrideNote}`,
    details: buildDetailsArray(info),
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

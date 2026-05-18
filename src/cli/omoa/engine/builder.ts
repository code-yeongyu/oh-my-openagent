import { existsSync, readFileSync } from "node:fs"
import { parseJsonc } from "../../../shared/jsonc-parser"
import { writeFileAtomically } from "../../../shared/write-file-atomically"
import { getConfigContext } from "../../config-manager"
import type { OmoaState } from "../state/omoa-state-schema"
import type { OmoaRankings } from "../state/omoa-rankings-schema"
import { resolveBestModel } from "./resolver"
import { validateConfig, type ValidationWarning } from "./validator"
import { backupConfigFile, type BackupResult } from "../../config-manager/backup-config"
import { getAgentRankings, getCategoryRankings } from "../state/rankings-manager"
import { OverridableAgentNameSchema } from "../../../config/schema/agent-names"

export interface BuildResult {
  success: boolean
  changes: AgentChange[]
  warnings: ValidationWarning[]
  backup: BackupResult
  error?: string
}

export interface AgentChange {
  target: string
  targetKind: "agent" | "category"
  field: "model" | "fallback_models"
  oldValue: string | undefined
  newValue: string | undefined
  reason: string
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function loadRuntimeConfig(): any | null {
  const { paths } = getConfigContext()
  const configPath = paths.omoConfig
  if (!existsSync(configPath)) return {}
  try {
    const content = readFileSync(configPath, "utf-8")
    return parseJsonc(content) ?? {}
  } catch {
    return null
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function saveRuntimeConfig(config: any): boolean {
  const { paths } = getConfigContext()
  const configPath = paths.omoConfig
  try {
    writeFileAtomically(configPath, JSON.stringify(config, null, 2) + "\n")
    return true
  } catch {
    return false
  }
}

export function buildConfig(
  state: OmoaState,
  rankings: OmoaRankings,
  dryRun = false,
): BuildResult {
  const config = loadRuntimeConfig()
  if (config === null) {
    return { success: false, changes: [], warnings: [], backup: { success: false, error: "Failed to load runtime config" }, error: "Failed to load runtime config" }
  }

  const changes: AgentChange[] = []
  const agentNames = OverridableAgentNameSchema.options
  const agents: Record<string, Record<string, unknown>> = config.agents ?? {}
  const categories: Record<string, Record<string, unknown>> = config.categories ?? {}

  for (const agentName of agentNames) {
    const agentRankings = getAgentRankings(rankings, agentName)
    if (agentRankings.length === 0) continue

    const resolved = resolveBestModel(agentRankings, state)
    const agent = agents[agentName] ?? {}
    const currentModel = agent.model as string | undefined

    if (currentModel !== resolved.primary) {
      changes.push({
        target: agentName,
        targetKind: "agent",
        field: "model",
        oldValue: currentModel,
        newValue: resolved.primary,
        reason: resolved.primaryReason,
      })
    }

    const currentFallbacks = normalizeFallbacks(agent.fallback_models)
    if (resolved.fallback !== currentFallbacks[0]) {
      changes.push({
        target: agentName,
        targetKind: "agent",
        field: "fallback_models",
        oldValue: currentFallbacks[0],
        newValue: resolved.fallback,
        reason: resolved.fallbackReason,
      })
    }
  }

  for (const categoryName of Object.keys(categories)) {
    const catRankings = getCategoryRankings(rankings, categoryName)
    if (catRankings.length === 0) continue

    const resolved = resolveBestModel(catRankings, state)
    const category = categories[categoryName] ?? {}
    const currentModel = category.model as string | undefined

    if (currentModel !== resolved.primary) {
      changes.push({
        target: categoryName,
        targetKind: "category",
        field: "model",
        oldValue: currentModel,
        newValue: resolved.primary,
        reason: resolved.primaryReason,
      })
    }

    const currentFallbacks = normalizeFallbacks(category.fallback_models)
    if (resolved.fallback !== currentFallbacks[0]) {
      changes.push({
        target: categoryName,
        targetKind: "category",
        field: "fallback_models",
        oldValue: currentFallbacks[0],
        newValue: resolved.fallback,
        reason: resolved.fallbackReason,
      })
    }
  }

  if (dryRun || changes.length === 0) {
    const validationState: Record<string, { model?: string; fallback_models?: unknown }> = {}
    // Include all existing agents
    for (const [k, v] of Object.entries(agents)) {
      const modelChange = changes.find((c) => c.target === k && c.targetKind === "agent" && c.field === "model")
      const fbChange = changes.find((c) => c.target === k && c.targetKind === "agent" && c.field === "fallback_models")
      validationState[k] = {
        model: (modelChange?.newValue ?? v?.model) as string | undefined,
        fallback_models: fbChange?.newValue ?? v?.fallback_models,
      }
    }
    // Also include agents that would be newly created from rankings
    for (const change of changes) {
      if (change.targetKind === "agent" && !validationState[change.target]) {
        validationState[change.target] = { model: undefined, fallback_models: undefined }
      }
      if (change.field === "model") validationState[change.target].model = change.newValue
      if (change.field === "fallback_models") validationState[change.target].fallback_models = change.newValue
    }
    const catValidationState: Record<string, { model?: string; fallback_models?: unknown }> = {}
    for (const [k, v] of Object.entries(categories)) {
      const modelChange = changes.find((c) => c.target === k && c.targetKind === "category" && c.field === "model")
      const fbChange = changes.find((c) => c.target === k && c.targetKind === "category" && c.field === "fallback_models")
      catValidationState[k] = {
        model: (modelChange?.newValue ?? v?.model) as string | undefined,
        fallback_models: fbChange?.newValue ?? v?.fallback_models,
      }
    }
    for (const change of changes) {
      if (change.targetKind === "category" && !catValidationState[change.target]) {
        catValidationState[change.target] = { model: undefined, fallback_models: undefined }
      }
      if (change.field === "model") catValidationState[change.target].model = change.newValue
      if (change.field === "fallback_models") catValidationState[change.target].fallback_models = change.newValue
    }
    const { warnings } = validateConfig(validationState, catValidationState, state)
    return { success: true, changes, warnings, backup: { success: true } }
  }

  const backup = backupConfigFile(getConfigContext().paths.omoConfig)

  const mutableConfig = { ...config }
  const mutableAgents: Record<string, Record<string, unknown>> = { ...(mutableConfig.agents ?? {}) }
  const mutableCategories: Record<string, Record<string, unknown>> = { ...(mutableConfig.categories ?? {}) }

  for (const change of changes) {
    if (change.targetKind === "agent") {
      if (!mutableAgents[change.target]) mutableAgents[change.target] = {}
      if (change.field === "model") {
        mutableAgents[change.target] = { ...mutableAgents[change.target], model: change.newValue }
      }
      if (change.field === "fallback_models") {
        const existing = normalizeFallbacks(mutableAgents[change.target].fallback_models)
        const updated = change.newValue ? [change.newValue, ...existing.slice(1)] : existing.slice(1)
        mutableAgents[change.target] = {
          ...mutableAgents[change.target],
          fallback_models: updated.length > 0 ? updated : undefined,
        }
      }
    }
    if (change.targetKind === "category") {
      if (!mutableCategories[change.target]) mutableCategories[change.target] = {}
      if (change.field === "model") {
        mutableCategories[change.target] = { ...mutableCategories[change.target], model: change.newValue }
      }
      if (change.field === "fallback_models") {
        const existing = normalizeFallbacks(mutableCategories[change.target].fallback_models)
        const updated = change.newValue ? [change.newValue, ...existing.slice(1)] : existing.slice(1)
        mutableCategories[change.target] = {
          ...mutableCategories[change.target],
          fallback_models: updated.length > 0 ? updated : undefined,
        }
      }
    }
  }

  mutableConfig.agents = mutableAgents
  mutableConfig.categories = mutableCategories
  const saved = saveRuntimeConfig(mutableConfig)

  if (!saved) {
    return { success: false, changes, warnings: [], backup, error: "Failed to write config" }
  }

  const { warnings } = validateConfig(
    mutableAgents as Record<string, { model?: string; fallback_models?: unknown }>,
    mutableCategories as Record<string, { model?: string; fallback_models?: unknown }>,
    state,
  )

  return { success: true, changes, warnings, backup }
}

function normalizeFallbacks(fallbacks: unknown): string[] {
  if (!fallbacks) return []
  if (typeof fallbacks === "string") return [fallbacks]
  if (Array.isArray(fallbacks)) return fallbacks.map((f) => typeof f === "string" ? f : (f as { model?: string })?.model ?? String(f))
  return []
}

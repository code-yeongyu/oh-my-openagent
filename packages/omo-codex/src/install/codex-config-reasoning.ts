import { replaceOrInsertRootSetting } from "./toml-section-editor"
import type { CodexModelCatalog, CodexReasoningProfileMatch } from "./codex-model-catalog"

const MANAGED_KEYS = ["model", "model_context_window", "model_reasoning_effort", "plan_mode_reasoning_effort"] as const

export function ensureCodexReasoningConfig(config: string, catalog: CodexModelCatalog): string {
  const current = readRootReasoningSettings(config)
  if (Object.keys(current).length > 0 && !matchesProfile(current, catalog.current) && !catalog.managedProfiles.some((profile) => matchesProfile(current, profile))) {
    return config
  }
  let next = replaceOrInsertRootSetting(config, "model", JSON.stringify(catalog.current.model))
  next = replaceOrInsertRootSetting(next, "model_context_window", catalog.current.modelContextWindow.toString())
  next = replaceOrInsertRootSetting(
    next,
    "model_reasoning_effort",
    JSON.stringify(catalog.current.modelReasoningEffort),
  )
  next = replaceOrInsertRootSetting(next, "plan_mode_reasoning_effort", JSON.stringify(catalog.current.planModeReasoningEffort))
  return next
}

function readRootReasoningSettings(config: string): CodexReasoningProfileMatch {
  const settings: {
    model?: string
    modelContextWindow?: number
    modelReasoningEffort?: string
    planModeReasoningEffort?: string
  } = {}
  for (const line of config.split(/\n/)) {
    if (isSectionHeader(line)) break
    for (const key of MANAGED_KEYS) {
      if (!isRootSetting(line, key)) continue
      const value = parseTomlScalar(line.slice(line.indexOf("=") + 1))
      if (key === "model" && typeof value === "string") settings.model = value
      if (key === "model_context_window" && typeof value === "number") settings.modelContextWindow = value
      if (key === "model_reasoning_effort" && typeof value === "string") settings.modelReasoningEffort = value
      if (key === "plan_mode_reasoning_effort" && typeof value === "string") settings.planModeReasoningEffort = value
    }
  }
  return settings
}

function matchesProfile(current: CodexReasoningProfileMatch, profile: CodexReasoningProfileMatch): boolean {
  for (const [key, value] of Object.entries(profile)) {
    if (current[key as keyof CodexReasoningProfileMatch] !== value) return false
  }
  return true
}

function parseTomlScalar(value: string): string | number | undefined {
  const trimmed = value.trim()
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed) as string
    } catch (error) {
      if (error instanceof SyntaxError) return undefined
      throw error
    }
  }
  const numeric = Number(trimmed)
  return Number.isFinite(numeric) ? numeric : undefined
}

function isSectionHeader(line: string): boolean {
  const trimmed = line.trim()
  return trimmed.startsWith("[") && trimmed.endsWith("]")
}

function isRootSetting(line: string, key: string): boolean {
  const trimmed = line.trimStart()
  if (trimmed.startsWith("#") || trimmed.startsWith("[")) return false
  const match = trimmed.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=/)
  return match?.[1] === key
}

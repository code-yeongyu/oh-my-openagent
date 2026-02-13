import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrideConfig } from "../types"
import type { CategoryConfig } from "../../config/schema"
import { deepMerge, migrateAgentConfig } from "../../shared"
import { resolvePromptAppend } from "./resolve-file-uri"

/**
 * Expands a category reference from an agent override into concrete config properties.
 * Category properties are applied unconditionally (overwriting factory defaults),
 * because the user's chosen category should take priority over factory base values.
 * Direct override properties applied later via mergeAgentConfig() will supersede these.
 */
export function applyCategoryOverride(
  config: AgentConfig,
  categoryName: string,
  mergedCategories: Record<string, CategoryConfig>
): AgentConfig {
  const categoryConfig = mergedCategories[categoryName]
  if (!categoryConfig) return config

  const result = { ...config } as AgentConfig & Record<string, unknown>
  if (categoryConfig.model) result.model = categoryConfig.model
  if (categoryConfig.variant !== undefined) result.variant = categoryConfig.variant
  if (categoryConfig.temperature !== undefined) result.temperature = categoryConfig.temperature
  if (categoryConfig.reasoningEffort !== undefined) result.reasoningEffort = categoryConfig.reasoningEffort
  if (categoryConfig.textVerbosity !== undefined) result.textVerbosity = categoryConfig.textVerbosity
  if (categoryConfig.thinking !== undefined) result.thinking = categoryConfig.thinking
  if (categoryConfig.top_p !== undefined) result.top_p = categoryConfig.top_p
  if (categoryConfig.maxTokens !== undefined) result.maxTokens = categoryConfig.maxTokens

  if (categoryConfig.prompt_append && typeof result.prompt === "string") {
    result.prompt = result.prompt + "\n" + resolvePromptAppend(categoryConfig.prompt_append)
  }

  return result as AgentConfig
}

export function mergeAgentConfig(
  base: AgentConfig,
  override: AgentOverrideConfig,
  directory?: string
): AgentConfig {
  const migratedOverride = migrateAgentConfig(override as Record<string, unknown>) as AgentOverrideConfig
  const { prompt_append, ...rest } = migratedOverride
  const merged = deepMerge(base, rest as Partial<AgentConfig>)

  if (prompt_append && merged.prompt) {
    merged.prompt = merged.prompt + "\n" + resolvePromptAppend(prompt_append, directory)
  }

  return merged
}

export function applyOverrides(
  config: AgentConfig,
  override: AgentOverrideConfig | undefined,
  mergedCategories: Record<string, CategoryConfig>,
  directory?: string
): AgentConfig {
  let result = config
  const overrideCategory = (override as Record<string, unknown> | undefined)?.category as string | undefined
  if (overrideCategory) {
    result = applyCategoryOverride(result, overrideCategory, mergedCategories)
  }

  if (override) {
    result = mergeAgentConfig(result, override, directory)
  }

  return result
}

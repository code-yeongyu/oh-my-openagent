import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrideConfig } from "../types"
import type { CategoryConfig } from "../../config/schema"
import { deepMerge, migrateAgentConfig } from "../../shared"
import { resolvePromptAppend } from "./resolve-file-uri"
import { resolveAgentPromptAppend } from "./resolve-prompt-append"

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
  if (categoryConfig.reasoning !== undefined) result.variant = categoryConfig.reasoning
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
  const {
    prompt_append,
    prompt_append_include_model_keywords,
    prompt_append_exclude_model_keywords,
    prompt_append_always,
    reasoning,
    ...rest
  } = migratedOverride
  const merged = deepMerge(base, rest as Partial<AgentConfig>)

  // Lower canonical `reasoning` to OpenCode's `variant` at build time so that
  // the TUI status bar and OpenCode's pre-hook provider-option construction
  // see the correct value. `reasoning` takes precedence over the deprecated
  // `variant` and `reasoningEffort`, matching resolveAgentVariant precedence.
  if (reasoning !== undefined) {
    merged.variant = reasoning
  }

  if (merged.prompt && typeof merged.prompt === 'string' && merged.prompt.startsWith('file://')) {
    merged.prompt = resolvePromptAppend(merged.prompt, directory)
  }

  const promptAppend = resolveAgentPromptAppend({
    model: typeof merged.model === "string" ? merged.model : undefined,
    promptAppend: prompt_append,
    promptAppendAlways: prompt_append_always,
    includeModelKeywords: prompt_append_include_model_keywords,
    excludeModelKeywords: prompt_append_exclude_model_keywords,
    configDir: directory,
  })
  if (promptAppend !== undefined && merged.prompt) {
    merged.prompt = merged.prompt + "\n" + promptAppend
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

import type { AgentConfig } from "@opencode-ai/sdk"
import type { AgentOverrideConfig } from "../types"
import { resolveClaudeThinkingBudget } from "../types"
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
  const { prompt_append, reasoning, ...rest } = migratedOverride
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

  if (prompt_append && merged.prompt) {
    merged.prompt = merged.prompt + "\n" + resolvePromptAppend(prompt_append, directory)
  }

  return merged
}

type EnabledThinkingConfig = { type?: unknown; budgetTokens?: unknown }

function readEnabledThinking(config: AgentConfig): EnabledThinkingConfig | undefined {
  const candidate = config as AgentConfig & { thinking?: unknown }
  if (typeof candidate.thinking !== "object" || candidate.thinking === null || Array.isArray(candidate.thinking)) {
    return undefined
  }
  const thinking = candidate.thinking as EnabledThinkingConfig
  return thinking.type === "enabled" ? thinking : undefined
}

/**
 * Scales an existing manual-path Claude thinking budget by the FINAL resolved
 * variant (issue #6387). Runs after category and direct overrides so the last
 * variant wins. Explicit thinking from the category or the direct override
 * always wins; agents without an enabled thinking block (GPT/GLM/adaptive
 * Claude paths) are returned untouched.
 */
function applyVariantDerivedThinkingBudget(
  config: AgentConfig,
  categoryConfig: CategoryConfig | undefined,
  override: AgentOverrideConfig | undefined,
): AgentConfig {
  const thinking = readEnabledThinking(config)
  if (!thinking) return config
  if (categoryConfig?.thinking !== undefined) return config
  if ((override as { thinking?: unknown } | undefined)?.thinking !== undefined) return config

  const variant = (config as AgentConfig & { variant?: string }).variant
  const budgetTokens = resolveClaudeThinkingBudget(variant)
  if (thinking.budgetTokens === budgetTokens) return config
  return {
    ...config,
    thinking: { ...thinking, budgetTokens },
  } as AgentConfig
}

export function applyOverrides(
  config: AgentConfig,
  override: AgentOverrideConfig | undefined,
  mergedCategories: Record<string, CategoryConfig>,
  directory?: string
): AgentConfig {
  let result = config
  const overrideCategory = (override as Record<string, unknown> | undefined)?.category as string | undefined
  const categoryConfig = overrideCategory ? mergedCategories[overrideCategory] : undefined
  if (overrideCategory) {
    result = applyCategoryOverride(result, overrideCategory, mergedCategories)
  }

  if (override) {
    result = mergeAgentConfig(result, override, directory)
  }

  return applyVariantDerivedThinkingBudget(result, categoryConfig, override)
}

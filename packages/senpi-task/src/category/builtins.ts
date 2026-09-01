import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import type { OmoCategoryConfig } from "@oh-my-opencode/omo-config-core"

import { ANTHROPIC_CATEGORIES } from "./anthropic-categories"
import { GOOGLE_CATEGORIES } from "./google-categories"
import { KIMI_CATEGORIES } from "./kimi-categories"
import { OPENAI_CATEGORIES } from "./openai-categories"
import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
import type { BuiltinCategoryDefinition } from "./types"

// Ported from packages/omo-opencode/src/tools/delegate-task/builtin-categories.ts.
export const BUILTIN_CATEGORY_DEFAULTS: readonly BuiltinCategoryDefinition[] = [
  ...GOOGLE_CATEGORIES,
  ...OPENAI_CATEGORIES,
  ...ANTHROPIC_CATEGORIES,
  ...KIMI_CATEGORIES,
] as const

export const DEFAULT_CATEGORIES: Readonly<Record<string, OmoCategoryConfig>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.map((definition) => [definition.name, definition.config]),
)

export const CATEGORY_DESCRIPTIONS: Readonly<Record<string, string>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.map((definition) => [definition.name, definition.description]),
)

export const CATEGORY_CALLER_GUIDANCE: Readonly<Record<string, string | undefined>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.map((definition) => [definition.name, definition.callerGuidance]),
)

export const CATEGORY_PROMPT_APPENDS: Readonly<Record<string, string>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.map((definition) => [definition.name, definition.promptAppend]),
)

function hasRequiresModel(
  definition: BuiltinCategoryDefinition,
): definition is BuiltinCategoryDefinition & { readonly requiresModel: string } {
  return definition.requiresModel !== undefined
}

export const BUILTIN_CATEGORY_REQUIRES_MODEL: Readonly<Record<string, string>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.filter(hasRequiresModel).map((definition) => [definition.name, definition.requiresModel]),
)

export function categoryGateModel(categoryName: string): string | undefined {
  return Object.hasOwn(BUILTIN_CATEGORY_REQUIRES_MODEL, categoryName)
    ? BUILTIN_CATEGORY_REQUIRES_MODEL[categoryName]
    : undefined
}

export function isCategoryGateSatisfied(
  categoryName: string,
  hasExplicitUserConfig: boolean,
  availableModelIds: ReadonlySet<string>,
): boolean {
  const gateModel = categoryGateModel(categoryName)
  if (gateModel === undefined || hasExplicitUserConfig) return true
  return availableModelIds.has(gateModel)
}

// Mirrors the kimi transform from model-core provider-model-id-transform.ts (kimi-k3 -> k3); the
// other chain providers resolve by their bare model id. senpi-task cannot import model-core here
// without adding a package dependency outside this task's scope (see fallback-chains.ts).
function transformChainModelId(provider: string, model: string): string {
  if (provider === "kimi-coding" || provider === "kimi-for-coding") {
    if (model === "kimi-k3") return "k3"
    if (model === "kimi-k3-256k") return "k3-256k"
  }
  return model
}

// A chain rung resolves when the live registry exposes its model id: either directly (the
// gateway-prefix unwrap in resolver.modelIdsOf surfaces vercel/openai/gpt-5.6-sol as gpt-5.6-sol)
// or through the provider-specific id transform (kimi-coding/k3 satisfies a kimi-k3 rung).
export function isCategoryChainRungResolvable(
  entry: DelegateFallbackEntry,
  availableModelIds: ReadonlySet<string>,
): boolean {
  if (availableModelIds.has(entry.model)) return true
  return entry.providers.some((provider) =>
    availableModelIds.has(transformChainModelId(provider, entry.model))
  )
}

// Dead-chain availability: a builtin-only category is usable only when at least one of its
// fallback-chain rungs resolves against the live registry. User-configured categories (any explicit
// categories.<name> entry) opt out - they are always listed and never gated.
export function isCategoryChainViable(
  categoryName: string,
  hasExplicitUserConfig: boolean,
  availableModelIds: ReadonlySet<string>,
): boolean {
  if (hasExplicitUserConfig) return true
  const chain = Object.hasOwn(CATEGORY_FALLBACK_CHAINS, categoryName)
    ? CATEGORY_FALLBACK_CHAINS[categoryName]
    : undefined
  if (chain === undefined || chain.length === 0) return true
  return chain.some((rung) => isCategoryChainRungResolvable(rung, availableModelIds))
}

export const CATEGORY_PROMPT_APPEND_RESOLVERS: Readonly<Record<string, (model: string | undefined) => string>> =
  Object.fromEntries(
    BUILTIN_CATEGORY_DEFAULTS
      .filter(hasPromptAppendResolver)
      .map((definition) => [definition.name, definition.resolvePromptAppend]),
  )

function hasPromptAppendResolver(
  definition: BuiltinCategoryDefinition,
): definition is BuiltinCategoryDefinition & { readonly resolvePromptAppend: (model: string | undefined) => string } {
  return definition.resolvePromptAppend !== undefined
}

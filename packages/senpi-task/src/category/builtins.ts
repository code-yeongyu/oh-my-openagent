import { transformModelForProvider, type DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
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
): definition is BuiltinCategoryDefinition & { readonly requiresModel: string | readonly string[] } {
  return definition.requiresModel !== undefined
}

// A gate lists every model id that opens the category; one present id is enough. ultrabrain and
// deep-high gate on gpt-6.2-astra alone and deep-low on gpt-6.2-sol alone (#14155), so a registry
// without a lane's exact model never falls through to an older, Fast or cross-family model.
export const BUILTIN_CATEGORY_REQUIRES_MODEL: Readonly<Record<string, readonly string[]>> = Object.fromEntries(
  BUILTIN_CATEGORY_DEFAULTS.filter(hasRequiresModel).map((definition) => [
    definition.name,
    typeof definition.requiresModel === "string" ? [definition.requiresModel] : definition.requiresModel,
  ]),
)

export function categoryGateModels(categoryName: string): readonly string[] | undefined {
  return Object.hasOwn(BUILTIN_CATEGORY_REQUIRES_MODEL, categoryName)
    ? BUILTIN_CATEGORY_REQUIRES_MODEL[categoryName]
    : undefined
}

function categoryChainProviders(categoryName: string): readonly string[] {
  const chain = Object.hasOwn(CATEGORY_FALLBACK_CHAINS, categoryName) ? CATEGORY_FALLBACK_CHAINS[categoryName] : []
  return chain.flatMap((rung) => rung.providers)
}

// `provider` serves `model` when the registry lists it under that provider, spelled as omo's routing
// tables spell it (claude-fable-5-1) or through the provider-specific id transform delegate-core
// applies at resolution time (github-copilot: claude-fable-5.1, kimi-coding: k3). The provider is
// part of the check: a gateway re-publishing the model (openrouter/anthropic/claude-opus-5.5) serves
// no builtin rung, because a builtin chain resolves only on the providers it lists (#9146).
function providerServesModel(provider: string, model: string, availableModels: ReadonlySet<string>): boolean {
  return (
    availableModels.has(`${provider}/${model}`) ||
    availableModels.has(`${provider}/${transformModelForProvider(provider, model)}`)
  )
}

// `availableModels` holds live registry models as `provider/id`. A gate opens only when a provider
// this category's chain lists serves a gate model; family and version comparison stays exact.
export function isCategoryGateSatisfied(
  categoryName: string,
  hasExplicitUserConfig: boolean,
  availableModels: ReadonlySet<string>,
): boolean {
  const gateModels = categoryGateModels(categoryName)
  if (gateModels === undefined || hasExplicitUserConfig) return true
  const chainProviders = categoryChainProviders(categoryName)
  return gateModels.some((gateModel) =>
    chainProviders.some((provider) => providerServesModel(provider, gateModel, availableModels)),
  )
}

export type ExactServedRung = readonly [narrowed: DelegateFallbackEntry, original: DelegateFallbackEntry]

const EXACT_MODEL_CATEGORIES: ReadonlySet<string> = new Set(
  BUILTIN_CATEGORY_DEFAULTS.filter((definition) => definition.exactModels === true).map(
    (definition) => definition.name,
  ),
)

function isExactModelCategory(categoryName: string): boolean {
  return EXACT_MODEL_CATEGORIES.has(categoryName)
}

// An `exactModels` category resolves its builtin chain on exact ids only, as its gate does (#14155).
// delegate-core matches a rung by substring and prefers the exact id only on a provider that has one, so
// a rung still listing a provider that serves just `gpt-6.2-sol-fast` would select it for `gpt-6.2-sol`.
// Each rung keeps only the providers serving its model exactly, paired with the rung it came from;
// undefined for every other category, whose chain resolves as listed.
export function exactServedRungs(
  categoryName: string,
  chain: readonly DelegateFallbackEntry[],
  availableModels: ReadonlySet<string>,
): readonly ExactServedRung[] | undefined {
  if (!isExactModelCategory(categoryName)) return undefined
  return chain.flatMap((rung): readonly ExactServedRung[] => {
    const providers = rung.providers.filter((provider) => providerServesModel(provider, rung.model, availableModels))
    return providers.length === 0 ? [] : [[{ ...rung, providers }, rung]]
  })
}

// A chain rung resolves when one of its own providers serves its model in the live registry.
export function isCategoryChainRungResolvable(
  entry: DelegateFallbackEntry,
  availableModels: ReadonlySet<string>,
): boolean {
  return entry.providers.some((provider) => providerServesModel(provider, entry.model, availableModels))
}

// Dead-chain availability: a builtin-only category is usable only when at least one of its
// fallback-chain rungs resolves against the live registry. User-configured categories (any explicit
// categories.<name> entry) opt out - they are always listed and never gated.
export function isCategoryChainViable(
  categoryName: string,
  hasExplicitUserConfig: boolean,
  availableModels: ReadonlySet<string>,
): boolean {
  if (hasExplicitUserConfig) return true
  const chain = Object.hasOwn(CATEGORY_FALLBACK_CHAINS, categoryName)
    ? CATEGORY_FALLBACK_CHAINS[categoryName]
    : undefined
  if (chain === undefined || chain.length === 0) return true
  return chain.some((rung) => isCategoryChainRungResolvable(rung, availableModels))
}

export const CATEGORY_PROMPT_APPEND_RESOLVERS: Readonly<Record<string, (model: string | undefined) => string>> =
  Object.fromEntries(
    BUILTIN_CATEGORY_DEFAULTS.filter(hasPromptAppendResolver).map((definition) => [
      definition.name,
      definition.resolvePromptAppend,
    ]),
  )

function hasPromptAppendResolver(
  definition: BuiltinCategoryDefinition,
): definition is BuiltinCategoryDefinition & { readonly resolvePromptAppend: (model: string | undefined) => string } {
  return definition.resolvePromptAppend !== undefined
}

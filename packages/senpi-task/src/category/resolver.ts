import {
  resolveModelForDelegateTask,
  type DelegateFallbackEntry,
} from "@oh-my-opencode/delegate-core"
import type {
  OmoCategoryConfig,
  OmoConfig,
  OmoFallbackModelObject,
  OmoFallbackModels,
} from "@oh-my-opencode/omo-config-core"

import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_PROMPT_APPEND_RESOLVERS,
  CATEGORY_PROMPT_APPENDS,
  DEFAULT_CATEGORIES,
  categoryGateModel,
  isCategoryChainRungResolvable,
  isCategoryChainViable,
  isCategoryGateSatisfied,
} from "./builtins"
import { buildRuntimeModelChain, chainRungCandidates, type ModelChainCandidate } from "../model-chain"
import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
import type {
  CategoryModelSelection,
  CategoryResolutionResult,
  ResolveCategoryOptions,
  ResolvedChildSpec,
  SenpiModelPort,
  SenpiModelRegistryPort,
} from "./types"

type ParsedModel = {
  readonly provider: string
  readonly modelId: string
}

type ParsedRegistryModel<TModel extends SenpiModelPort> = ParsedModel & {
  readonly model: TModel
  readonly displayName?: string
}

type ModelSelectionInput = {
  readonly selectedModel: string
  readonly variant?: string
  readonly fallbackEntry?: DelegateFallbackEntry
  readonly matchedFallback?: boolean
}

type AvailableModelsParseResult = {
  readonly models: readonly string[]
  readonly validContainer: boolean
}

const SECRET_LIKE_MODEL_FIELD_NAMES: ReadonlySet<string> = new Set([
  "accesstoken", "apikey", "auth", "authorization",
  "bearertoken", "clientsecret", "password", "privatekey",
  "privatetoken", "secret", "secretkey", "token",
] as const)

function formatModel(model: ParsedModel): string {
  return `${model.provider}/${model.modelId}`
}

function normalizeModelFieldName(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase()
}

function hasSecretLikeModelField(model: object): boolean {
  return Object.getOwnPropertyNames(model).some((key) =>
    SECRET_LIKE_MODEL_FIELD_NAMES.has(normalizeModelFieldName(key))
  )
}

function ownStringDataProperty(model: object, key: "provider" | "id" | "name"): string | undefined {
  const descriptor = Object.getOwnPropertyDescriptor(model, key)
  return descriptor && "value" in descriptor && typeof descriptor.value === "string" ? descriptor.value : undefined
}

function isSenpiModelPort<TModel extends SenpiModelPort>(model: unknown): model is TModel {
  if (typeof model !== "object" || model === null || hasSecretLikeModelField(model)) return false
  return ownStringDataProperty(model, "provider") !== undefined && ownStringDataProperty(model, "id") !== undefined
}

function parseRegistryModel<TModel extends SenpiModelPort>(
  model: unknown,
  expected?: ParsedModel,
): ParsedRegistryModel<TModel> | undefined {
  if (!isSenpiModelPort<TModel>(model)) {
    return undefined
  }
  const provider = ownStringDataProperty(model, "provider")
  const modelId = ownStringDataProperty(model, "id")
  const displayName = ownStringDataProperty(model, "name")
  if (!provider || !modelId || (expected !== undefined && (provider !== expected.provider || modelId !== expected.modelId))) {
    return undefined
  }
  return { model, provider, modelId, ...(displayName !== undefined && displayName.trim().length > 0 && displayName.length <= 120 && !/[\u0000-\u001f\u007f-\u009f]/u.test(displayName) ? { displayName } : {}) }
}

function parseModel(model: string): ParsedModel | undefined {
  const separatorIndex = model.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex === model.length - 1) {
    return undefined
  }
  return {
    provider: model.slice(0, separatorIndex),
    modelId: model.slice(separatorIndex + 1),
  }
}

function fallbackObjectToString(fallback: OmoFallbackModelObject): string {
  return fallback.variant ? `${fallback.model} ${fallback.variant}` : fallback.model
}

function flattenFallbackModels(fallbackModels: OmoFallbackModels | undefined): readonly string[] | undefined {
  if (fallbackModels === undefined) {
    return undefined
  }
  if (typeof fallbackModels === "string") {
    return [fallbackModels]
  }
  return fallbackModels.map((fallback) => typeof fallback === "string" ? fallback : fallbackObjectToString(fallback))
}

function categoryModelCandidates(config: OmoCategoryConfig): readonly ModelChainCandidate[] {
  // Canonical models[] wins over the legacy model + fallback_models branch: entry zero is the
  // primary model and the rest become the ordered runtime fallback chain.
  if (config.models !== undefined && config.models.length > 0) {
    return config.models.map((entry): ModelChainCandidate => {
      if (typeof entry === "string") return { model: entry }
      return {
        model: entry.model,
        ...(entry.variant !== undefined ? { variant: entry.variant } : {}),
        ...(entry.reasoning !== undefined ? { reasoningEffort: entry.reasoning } : {}),
      }
    })
  }

  const categoryReasoning = config.reasoning ?? config.reasoningEffort
  const primary = config.model === undefined
    ? []
    : [{
        model: config.model,
        ...(config.variant !== undefined ? { variant: config.variant } : {}),
        ...(categoryReasoning !== undefined
          ? { reasoningEffort: categoryReasoning }
          : {}),
      }]
  const fallbackModels = config.fallback_models
  if (fallbackModels === undefined) return primary

  const entries = typeof fallbackModels === "string" ? [fallbackModels] : fallbackModels
  const fallbacks = entries.map((entry): ModelChainCandidate => {
    if (typeof entry === "string") {
      return {
        model: entry,
        ...(config.variant !== undefined ? { variant: config.variant } : {}),
        ...(config.reasoningEffort !== undefined
          ? { reasoningEffort: config.reasoningEffort }
          : {}),
      }
    }
    return {
      model: entry.model,
      ...(entry.variant ?? config.variant) !== undefined
        ? { variant: entry.variant ?? config.variant }
        : {},
      ...(entry.reasoning ?? config.reasoning ?? entry.reasoningEffort ?? config.reasoningEffort) !== undefined
        ? { reasoningEffort: entry.reasoning ?? config.reasoning ?? entry.reasoningEffort ?? config.reasoningEffort }
        : {},
    }
  })
  return [...primary, ...fallbacks]
}

function availableCategoryNames(config: OmoConfig, availableModelIds?: ReadonlySet<string>): readonly string[] {
  const names = Array.from(new Set([...Object.keys(DEFAULT_CATEGORIES), ...Object.keys(config.categories ?? {})])).sort()
  if (availableModelIds === undefined) return names
  const userCategories = config.categories ?? {}
  return names.filter((name) => {
    const hasExplicitUserConfig = getOwnRecordValue(userCategories, name) !== undefined
    return isCategoryGateSatisfied(name, hasExplicitUserConfig, availableModelIds)
      && isCategoryChainViable(name, hasExplicitUserConfig, availableModelIds)
  })
}

// Gated listing for the disabled/not_found early returns. The registry is only consulted best
// effort here: a throwing or malformed registry degrades to the ungated list (today's behavior),
// since those results never resolve a model anyway.
function gatedAvailableCategories<TModel extends SenpiModelPort>(
  config: OmoConfig,
  senpiModelRegistry: SenpiModelRegistryPort<TModel>,
): readonly string[] {
  try {
    const parsed = parseAvailableModels(senpiModelRegistry.getAvailable())
    if (!parsed.validContainer) return availableCategoryNames(config)
    return availableCategoryNames(config, modelIdsOf(parsed.models))
  } catch {
    return availableCategoryNames(config)
  }
}

// Chain providers with no model in the live registry, in chain order, deduplicated.
function missingChainProviders(
  chain: readonly DelegateFallbackEntry[],
  availableModels: readonly string[],
): readonly string[] {
  const connected = new Set(availableModels.map((model) => model.slice(0, model.indexOf("/"))))
  const missing: string[] = []
  for (const rung of chain) {
    for (const provider of rung.providers) {
      if (!connected.has(provider) && !missing.includes(provider)) missing.push(provider)
    }
  }
  return missing
}

// A gateway provider re-publishes an upstream model under `<gateway>/<upstream-vendor>/<model-id>`
// (e.g. `vercel/openai/gpt-5.6-sol`). Only these known upstream vendor prefixes are unwrapped, so an
// unrelated model that merely ends in a gate model's name cannot open that gate.
const GATEWAY_UPSTREAM_VENDOR_PREFIXES = ["openai", "anthropic", "google"] as const

function modelIdsOf(models: readonly string[]): ReadonlySet<string> {
  const ids = new Set<string>()
  for (const entry of models) {
    const modelId = entry.slice(entry.indexOf("/") + 1)
    ids.add(modelId)
    const separatorIndex = modelId.indexOf("/")
    if (separatorIndex <= 0) continue
    const vendor = modelId.slice(0, separatorIndex)
    const upstreamId = modelId.slice(separatorIndex + 1)
    if (!upstreamId.includes("/") && GATEWAY_UPSTREAM_VENDOR_PREFIXES.some((prefix) => prefix === vendor)) {
      ids.add(upstreamId)
    }
  }
  return ids
}

function getOwnRecordValue<TValue>(
  record: Readonly<Record<string, TValue>>,
  key: string,
): TValue | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
}

function parseAvailableModels(models: unknown): AvailableModelsParseResult {
  if (!Array.isArray(models)) {
    return { models: [], validContainer: false }
  }
  return { models: models.map((model) => parseRegistryModel(model)).filter((model) => model !== undefined).map(formatModel).sort(), validContainer: true }
}

function promptAppendForCategory(categoryName: string, model: string | undefined, userPromptAppend: string | undefined): string | undefined {
  const promptAppendResolver = getOwnRecordValue(CATEGORY_PROMPT_APPEND_RESOLVERS, categoryName)
  const basePromptAppend = promptAppendResolver?.(model)
    ?? getOwnRecordValue(CATEGORY_PROMPT_APPENDS, categoryName)
    ?? ""
  if (!userPromptAppend) {
    return basePromptAppend || undefined
  }
  return basePromptAppend ? `${basePromptAppend}\n\n${userPromptAppend}` : userPromptAppend
}

function nearestFallback(selection: CategoryModelSelection): string | undefined {
  const entry = selection.fallbackEntry
  const provider = entry?.providers[0]
  return entry && provider ? `${provider}/${entry.model}` : undefined
}

function modelSelection(input: ModelSelectionInput): CategoryModelSelection {
  const { fallbackEntry, matchedFallback, selectedModel, variant } = input
  return {
    selectedModel,
    ...(variant !== undefined ? { variant } : {}),
    ...(fallbackEntry !== undefined ? { fallbackEntry } : {}),
    matchedFallback: matchedFallback === true,
  }
}

export function resolveCategory<TModel extends SenpiModelPort>(
  categoryName: string,
  omoConfig: OmoConfig,
  senpiModelRegistry: SenpiModelRegistryPort<TModel>,
  options: ResolveCategoryOptions = {},
): CategoryResolutionResult<TModel> {
  const availableCategories = availableCategoryNames(omoConfig)
  const userConfig = omoConfig.categories ? getOwnRecordValue(omoConfig.categories, categoryName) : undefined
  if (userConfig?.disable === true) {
    return {
      kind: "disabled",
      category: categoryName,
      reason: `Category "${categoryName}" is disabled by omo.json`,
      availableCategories: gatedAvailableCategories(omoConfig, senpiModelRegistry),
    }
  }

  const builtinConfig = getOwnRecordValue(DEFAULT_CATEGORIES, categoryName)
  if (!builtinConfig && !userConfig) {
    return { kind: "not_found", category: categoryName, availableCategories: gatedAvailableCategories(omoConfig, senpiModelRegistry) }
  }

  const config = { ...builtinConfig, ...userConfig }
  const availableModelsResult = parseAvailableModels(senpiModelRegistry.getAvailable())
  const availableModels = availableModelsResult.models
  if (!availableModelsResult.validContainer) {
    return {
      kind: "model_unavailable",
      category: categoryName,
      attemptedModel: config.model,
      availableModels,
      availableCategories,
    }
  }

  const availableModelIds = modelIdsOf(availableModels)
  const gatedCategories = availableCategoryNames(omoConfig, availableModelIds)
  const fallbackChain = getOwnRecordValue(CATEGORY_FALLBACK_CHAINS, categoryName)
  const chainDead = fallbackChain !== undefined
    && fallbackChain.length > 0
    && !fallbackChain.some((rung) => isCategoryChainRungResolvable(rung, availableModelIds))
  const deadChain = chainDead && fallbackChain !== undefined
    ? { attempted_chain: fallbackChain, missing_providers: missingChainProviders(fallbackChain, availableModels) }
    : undefined
  if (!isCategoryGateSatisfied(categoryName, userConfig !== undefined, availableModelIds)) {
    return {
      kind: "model_unavailable",
      category: categoryName,
      attemptedModel: builtinConfig?.model ?? config.model,
      availableModels,
      availableCategories: gatedCategories,
      ...(deadChain ?? {}),
    }
  }

  // Dead-chain short-circuit: a builtin chain with zero resolvable rungs can never produce a model,
  // so fail before resolution with the rungs that were attempted. An explicit user model or user
  // fallback list opts the category out (its failure stays a plain user-model miss without chain
  // details), and a caller-supplied system default remains the resolver's last resort.
  const userHasCanonicalModels = (userConfig?.models?.length ?? 0) > 0
  if (deadChain !== undefined && !userHasCanonicalModels && userConfig?.model === undefined && userConfig?.fallback_models === undefined && options.systemDefaultModel === undefined) {
    return {
      kind: "model_unavailable",
      category: categoryName,
      attemptedModel: builtinConfig?.model ?? config.model,
      availableModels,
      availableCategories: gatedCategories,
      ...deadChain,
    }
  }

  // Canonical models[] wins over the legacy model + fallback_models branch only when present;
  // builtin categories have no models key and must keep their chain-based resolution.
  const canonicalChain = config.models !== undefined && config.models.length > 0
    ? categoryModelCandidates(config)
    : undefined
  const canonicalReasoningByModel = new Map(
    (canonicalChain ?? []).map((candidate) => [candidate.model, candidate.reasoningEffort]),
  )
  const userModel = canonicalChain !== undefined ? canonicalChain[0].model : userConfig?.model
  const userFallbackModels = canonicalChain !== undefined
    ? canonicalChain.slice(1).map((candidate) => candidate.model)
    : flattenFallbackModels(config.fallback_models)
  const resolution = resolveModelForDelegateTask(
    {
      userModel,
      userFallbackModels,
      categoryDefaultModel: builtinConfig?.model,
      isUserConfiguredCategoryModel: false,
      fallbackChain,
      availableModels: new Set(availableModels),
      systemDefaultModel: options.systemDefaultModel,
    },
    {
      connectedProviders: null,
      hasProviderModelsCache: true,
      hasConnectedProvidersCache: true,
    },
  )

  if (!resolution || "skipped" in resolution) {
    return {
      kind: "model_unavailable",
      category: categoryName,
      attemptedModel: config.model,
      availableModels,
      availableCategories: gatedCategories,
    }
  }

  const selection = modelSelection(
    {
      selectedModel: resolution.model,
      variant: resolution.variant,
      fallbackEntry: resolution.fallbackEntry,
      matchedFallback: resolution.matchedFallback,
    },
  )
  const parsedModel = parseModel(selection.selectedModel)
  const foundModel = parsedModel ? parseRegistryModel<TModel>(senpiModelRegistry.find(parsedModel.provider, parsedModel.modelId), parsedModel) : undefined
  if (!parsedModel || !foundModel) {
    const fallback = nearestFallback(selection)
    return {
      kind: "model_unavailable",
      category: categoryName,
      attemptedModel: selection.selectedModel,
      availableModels,
      availableCategories: gatedCategories,
      ...(fallback !== undefined ? { nearestFallback: fallback } : {}),
      ...(selection.fallbackEntry !== undefined ? { fallbackEntry: selection.fallbackEntry } : {}),
    }
  }

  const prompt_append = promptAppendForCategory(categoryName, selection.selectedModel, userConfig?.prompt_append)
  const variant = userConfig?.variant ?? selection.variant ?? config.variant
  // Canonical reasoning outranks the legacy reasoningEffort, whether it sits on the category or
  // on the selected canonical models entry; legacy reasoningEffort is the final fallback.
  const effectiveReasoningEffort = canonicalReasoningByModel.get(selection.selectedModel)
      ?? config.reasoning
      ?? config.reasoningEffort
  const availableModelSet = new Set(availableModels)
  // Builtin chain rungs remaining after the selected one extend the runtime retry chain, appended
  // after any user-configured fallback_models so user entries keep priority (dedupe keeps firsts).
  const chainCandidates = fallbackChain === undefined
    ? []
    : chainRungCandidates({
        chain: fallbackChain,
        selectedModel: selection.selectedModel,
        ...(selection.fallbackEntry !== undefined ? { selectedRungEntry: selection.fallbackEntry } : {}),
        availableModels: availableModelSet,
      })
  const runtimeModelChain = buildRuntimeModelChain({
    candidates: [...categoryModelCandidates(config), ...chainCandidates],
    selectedModel: selection.selectedModel,
    availableModels: availableModelSet,
    source: "category",
  })
  const spec: ResolvedChildSpec<TModel> = {
    model: foundModel.model,
    provider: foundModel.provider,
    modelId: foundModel.modelId,
    ...runtimeModelChain,
    ...(foundModel.displayName !== undefined ? { displayName: foundModel.displayName } : {}),
    ...(variant !== undefined ? { variant } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.top_p !== undefined ? { top_p: config.top_p } : {}),
    ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    ...(config.thinking !== undefined ? { thinking: config.thinking } : {}),
    ...(effectiveReasoningEffort !== undefined ? { reasoningEffort: effectiveReasoningEffort } : {}),
    ...(config.tools !== undefined ? { tools: config.tools } : {}),
    ...(prompt_append !== undefined ? { prompt_append } : {}),
  }
  return {
    kind: "resolved",
    category: categoryName,
    spec,
    config,
    description: userConfig?.description ?? getOwnRecordValue(CATEGORY_DESCRIPTIONS, categoryName),
    modelSelection: selection,
    availableCategories: gatedCategories,
  }
}

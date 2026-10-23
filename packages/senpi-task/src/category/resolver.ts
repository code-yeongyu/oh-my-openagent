import { resolveModelForDelegateTask } from "@oh-my-opencode/delegate-core"
import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"
import { canonicalCategoryName, type OmoConfig } from "@oh-my-opencode/omo-config-core"

import {
  CATEGORY_DESCRIPTIONS,
  CATEGORY_PROMPT_APPEND_RESOLVERS,
  CATEGORY_PROMPT_APPENDS,
  DEFAULT_CATEGORIES,
  isCategoryChainRungResolvable,
  isCategoryGateSatisfied,
} from "./builtins"
import { availableCategoryNames, gatedAvailableCategories } from "./available-names"
import { missingChainProviders, unlistedProviderModel } from "./chain-diagnostics"
import { buildRuntimeModelChain, chainRungCandidates } from "../model-chain"
import { withoutExcludedModels } from "../model-exclusion"
import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
import { parseAvailableModels, parseModel, parseRegistryModel } from "./registry-models"
import { categoryModelCandidates, flattenFallbackModels } from "./user-candidates"
import type {
  CategoryModelSelection,
  CategoryResolutionResult,
  ResolveCategoryOptions,
  ResolvedChildSpec,
  SenpiModelPort,
  SenpiModelRegistryPort,
} from "./types"

export { resolveAvailableCategoryNames } from "./available-names"
export { builtinCategoryChainCandidates, missingChainProviders, unlistedProviderModel } from "./chain-diagnostics"
export { parseAvailableModels } from "./registry-models"

type ModelSelectionInput = {
  readonly selectedModel: string
  readonly variant?: string
  readonly fallbackEntry?: DelegateFallbackEntry
  readonly matchedFallback?: boolean
}

function getOwnRecordValue<TValue>(
  record: Readonly<Record<string, TValue>>,
  key: string,
): TValue | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined
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
  requestedCategoryName: string,
  omoConfig: OmoConfig,
  registry: SenpiModelRegistryPort<TModel>,
  options: ResolveCategoryOptions = {},
): CategoryResolutionResult<TModel> {
  const senpiModelRegistry = withoutExcludedModels(registry, omoConfig.exclude_models)
  // A retired builtin name resolves to its replacement so third-party skills and AGENTS.md text
  // spawning the old category keep working; a user category of that name still wins over the alias.
  const userCategories = omoConfig.categories
  const categoryName = userCategories !== undefined && Object.hasOwn(userCategories, requestedCategoryName)
    ? requestedCategoryName
    : canonicalCategoryName(requestedCategoryName)
  const availableCategories = availableCategoryNames(omoConfig)
  const userConfig = userCategories ? getOwnRecordValue(userCategories, categoryName) : undefined
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

  const availableModelSet: ReadonlySet<string> = new Set(availableModels)
  const gatedCategories = availableCategoryNames(omoConfig, availableModelSet)
  const fallbackChain = getOwnRecordValue(CATEGORY_FALLBACK_CHAINS, categoryName)
  const chainDead = fallbackChain !== undefined
    && fallbackChain.length > 0
    && !fallbackChain.some((rung) => isCategoryChainRungResolvable(rung, availableModelSet))
  const unlistedModel = chainDead && fallbackChain !== undefined
    ? unlistedProviderModel(fallbackChain, availableModels)
    : undefined
  const deadChain = chainDead && fallbackChain !== undefined
    ? {
        attempted_chain: fallbackChain,
        missing_providers: missingChainProviders(fallbackChain, availableModels),
        ...(unlistedModel !== undefined ? { unlisted_provider_model: unlistedModel } : {}),
      }
    : undefined
  if (!isCategoryGateSatisfied(categoryName, userConfig !== undefined, availableModelSet)) {
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

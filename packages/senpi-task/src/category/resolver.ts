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
} from "./builtins"
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

type ChildSpecInput<TModel extends SenpiModelPort> = {
  readonly model: TModel
  readonly selection: CategoryModelSelection
  readonly config: OmoCategoryConfig
  readonly userVariant?: string
  readonly prompt_append?: string
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

function formatModel(model: SenpiModelPort): string {
  return `${model.provider}/${model.id}`
}

function normalizeModelFieldName(key: string): string {
  return key.replaceAll(/[^a-zA-Z0-9]/g, "").toLowerCase()
}

function hasSecretLikeModelField(model: object): boolean {
  return Object.getOwnPropertyNames(model).some((key) =>
    SECRET_LIKE_MODEL_FIELD_NAMES.has(normalizeModelFieldName(key))
  )
}

function isSenpiModelPort<TModel extends SenpiModelPort>(model: unknown): model is TModel {
  return (
    typeof model === "object" &&
    model !== null &&
    !hasSecretLikeModelField(model) &&
    Object.hasOwn(model, "provider") &&
    Object.hasOwn(model, "id") &&
    "provider" in model &&
    "id" in model &&
    typeof model.provider === "string" &&
    typeof model.id === "string"
  )
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

function availableCategoryNames(config: OmoConfig): readonly string[] {
  return Array.from(new Set([...Object.keys(DEFAULT_CATEGORIES), ...Object.keys(config.categories ?? {})])).sort()
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
  return { models: models.filter(isSenpiModelPort).map(formatModel).sort(), validContainer: true }
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

function childSpec<TModel extends SenpiModelPort>(input: ChildSpecInput<TModel>): ResolvedChildSpec<TModel> {
  const { config, model, prompt_append, selection, userVariant } = input
  const variant = userVariant ?? selection.variant ?? config.variant
  return {
    model,
    provider: model.provider,
    modelId: model.id,
    ...(variant !== undefined ? { variant } : {}),
    ...(config.temperature !== undefined ? { temperature: config.temperature } : {}),
    ...(config.top_p !== undefined ? { top_p: config.top_p } : {}),
    ...(config.maxTokens !== undefined ? { maxTokens: config.maxTokens } : {}),
    ...(config.thinking !== undefined ? { thinking: config.thinking } : {}),
    ...(config.reasoningEffort !== undefined ? { reasoningEffort: config.reasoningEffort } : {}),
    ...(config.tools !== undefined ? { tools: config.tools } : {}),
    ...(prompt_append !== undefined ? { prompt_append } : {}),
  }
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
      availableCategories,
    }
  }

  const builtinConfig = getOwnRecordValue(DEFAULT_CATEGORIES, categoryName)
  if (!builtinConfig && !userConfig) {
    return { kind: "not_found", category: categoryName, availableCategories }
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
  const fallbackChain = getOwnRecordValue(CATEGORY_FALLBACK_CHAINS, categoryName)
  const resolution = resolveModelForDelegateTask(
    {
      userModel: userConfig?.model,
      userFallbackModels: flattenFallbackModels(config.fallback_models),
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
      availableCategories,
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
  const foundModel = parsedModel ? senpiModelRegistry.find(parsedModel.provider, parsedModel.modelId) : undefined
  const model = isSenpiModelPort<TModel>(foundModel) ? foundModel : undefined
  if (!parsedModel || !model) {
    const fallback = nearestFallback(selection)
    return {
      kind: "model_unavailable",
      category: categoryName,
      attemptedModel: selection.selectedModel,
      availableModels,
      availableCategories,
      ...(fallback !== undefined ? { nearestFallback: fallback } : {}),
      ...(selection.fallbackEntry !== undefined ? { fallbackEntry: selection.fallbackEntry } : {}),
    }
  }

  const prompt_append = promptAppendForCategory(categoryName, selection.selectedModel, userConfig?.prompt_append)
  return {
    kind: "resolved",
    category: categoryName,
    spec: childSpec({ model, selection, config, userVariant: userConfig?.variant, prompt_append }),
    config,
    description: userConfig?.description ?? getOwnRecordValue(CATEGORY_DESCRIPTIONS, categoryName),
    modelSelection: selection,
    availableCategories,
  }
}

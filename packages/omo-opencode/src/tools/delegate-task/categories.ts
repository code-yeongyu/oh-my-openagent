import type { CategoryConfig, CategoriesConfig } from "../../config/schema"
import { DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS, categoryGateServedModels } from "./constants"
import { resolveModel } from "../../shared/model-resolver"
import { fuzzyMatchModel } from "../../shared/model-availability"
import { normalizeModel } from "../../shared/model-normalization"
import { parseModelString } from "../../shared/model-string-parser"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { isAnyFallbackModelAvailable } from "../../shared/fallback-model-availability"
import { log } from "../../shared/logger"

export interface ResolveCategoryConfigOptions {
  userCategories?: CategoriesConfig
  inheritedModel?: string
  systemDefaultModel?: string
  availableModels?: Set<string>
  /** The user's sisyphus-junior model, which every category runs on when set. */
  modelOverride?: string
}

export interface ResolveCategoryConfigResult {
  config: CategoryConfig
  promptAppend: string
  model: string | undefined
  isUserConfiguredModel: boolean
}

type CategoryModelEntry = NonNullable<CategoryConfig["models"]>[number]

function resolveAvailableModelEntry(
  entry: CategoryModelEntry,
  availableModels: Set<string>,
): CategoryModelEntry | null {
  const configuredModel = typeof entry === "string" ? entry : entry.model
  const parsedModel = parseModelString(configuredModel)
  if (!parsedModel) return null

  const fullModel = `${parsedModel.providerID}/${parsedModel.modelID}`
  const matchedModel = fuzzyMatchModel(fullModel, availableModels, [parsedModel.providerID])
  if (!matchedModel) return null

  if (typeof entry === "string") {
    return parsedModel.variant ? `${matchedModel}(${parsedModel.variant})` : matchedModel
  }

  return {
    ...entry,
    model: matchedModel,
    variant: entry.variant ?? parsedModel.variant,
  }
}

/**
 * Resolve the configuration for a given category name.
 * Merges default and user configurations, handles model resolution.
 */
export function resolveCategoryConfig(
  categoryName: string,
  options: ResolveCategoryConfigOptions,
): ResolveCategoryConfigResult | null {
  const {
    userCategories,
    inheritedModel: _inheritedModel,
    systemDefaultModel,
    availableModels,
    modelOverride,
  } = options

  const defaultConfig = DEFAULT_CATEGORIES[categoryName]
  const configuredUserConfig = userCategories?.[categoryName]
  const hasExplicitUserConfig = configuredUserConfig !== undefined

  if (configuredUserConfig?.disable) {
    return null
  }

  let userConfig = configuredUserConfig
  if (configuredUserConfig?.models && availableModels && availableModels.size > 0) {
    const models = configuredUserConfig.models
      .map((entry) => resolveAvailableModelEntry(entry, availableModels))
      .filter((entry): entry is CategoryModelEntry => entry !== null)
    if (models.length === 0) return null
    userConfig = { ...configuredUserConfig, models }
  }

  const categoryReq = CATEGORY_MODEL_REQUIREMENTS[categoryName]
  // A gated category opens only when a provider its chain lists serves a gate model under that exact id,
  // or when the user picks the model; a variant or prompt tweak alone keeps the builtin model and its gate.
  const hasUserModelChoice =
    modelOverride !== undefined ||
    configuredUserConfig?.model !== undefined ||
    configuredUserConfig?.models !== undefined ||
    configuredUserConfig?.fallback_models !== undefined
  const servedGateModels = availableModels ? categoryGateServedModels(categoryName, availableModels) : undefined
  if (servedGateModels?.size === 0 && !hasUserModelChoice) {
    log(`[resolveCategoryConfig] Category ${categoryName} has no provider serving its exact gate model`)
    return null
  }
  // requiresAnyModel: the lane opens only on one of its own chain models. Without this check the executor
  // walks the chain, finds nothing, and lands on the session's system default model.
  if (
    categoryReq?.requiresAnyModel &&
    availableModels &&
    !hasExplicitUserConfig &&
    modelOverride === undefined &&
    !isAnyFallbackModelAvailable(categoryReq.fallbackChain, availableModels)
  ) {
    log(`[resolveCategoryConfig] Category ${categoryName} has no available model in its fallback chain`)
    return null
  }
  const defaultPromptAppend = CATEGORY_PROMPT_APPENDS[categoryName] ?? ""

  if (!defaultConfig && !userConfig) {
    return null
  }

  // Model priority for categories: user override > category default > system default
  // Categories have explicit models - no inheritance from parent session
  const model = resolveModel({
    userModel: userConfig?.model,
    inheritedModel: defaultConfig?.model, // Category's built-in model takes precedence over system default
    systemDefault: systemDefaultModel,
  })
  const isUserConfiguredModel = normalizeModel(userConfig?.model) !== undefined || userConfig?.models !== undefined
  const config: CategoryConfig = {
    ...defaultConfig,
    ...userConfig,
    model,
    variant: userConfig?.variant ?? (isUserConfiguredModel ? undefined : defaultConfig?.variant),
  }

  let promptAppend = defaultPromptAppend
  if (userConfig?.prompt_append) {
    promptAppend = defaultPromptAppend
      ? defaultPromptAppend + "\n\n" + userConfig.prompt_append
      : userConfig.prompt_append
  }

  return { config, promptAppend, model, isUserConfiguredModel }
}

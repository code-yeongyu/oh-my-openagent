import type { CategoryConfig, CategoriesConfig } from "../../config/schema"
import { DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS, BUILTIN_CATEGORY_REQUIRES_MODEL } from "./constants"
import { resolveModel } from "../../shared/model-resolver"
import { fuzzyMatchModel, isModelAvailable } from "../../shared/model-availability"
import { normalizeModel } from "../../shared/model-normalization"
import { parseModelString } from "../../shared/model-string-parser"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { log } from "../../shared/logger"

export interface ResolveCategoryConfigOptions {
  userCategories?: CategoriesConfig
  inheritedModel?: string
  systemDefaultModel?: string
  availableModels?: Set<string>
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
  options: ResolveCategoryConfigOptions
): ResolveCategoryConfigResult | null {
  const { userCategories, inheritedModel: _inheritedModel, systemDefaultModel, availableModels } = options

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
  const requiredModel = categoryReq?.requiresModel ?? BUILTIN_CATEGORY_REQUIRES_MODEL[categoryName]
  if (requiredModel && availableModels && !hasExplicitUserConfig) {
    if (!isModelAvailable(requiredModel, availableModels)) {
      log(`[resolveCategoryConfig] Category ${categoryName} requires ${requiredModel} but not available`)
      return null
    }
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
  const isUserConfiguredModel = normalizeModel(userConfig?.model) !== undefined
  const config: CategoryConfig = {
    ...defaultConfig,
    ...userConfig,
    model,
    variant: userConfig?.variant ?? defaultConfig?.variant,
  }

  let promptAppend = defaultPromptAppend
  if (userConfig?.prompt_append) {
    promptAppend = defaultPromptAppend
      ? defaultPromptAppend + "\n\n" + userConfig.prompt_append
      : userConfig.prompt_append
  }

  return { config, promptAppend, model, isUserConfiguredModel }
}

import type { CategoryConfig, CategoriesConfig } from "../../config/schema"
import { DEFAULT_CATEGORIES, CATEGORY_PROMPT_APPENDS } from "./constants"
import { resolveModel } from "../../shared/model-resolver"
import { isModelAvailable } from "../../shared/model-availability"
import { normalizeModel } from "../../shared/model-normalization"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { resolvePromptAppend } from "../../agents/builtin-agents/resolve-file-uri"
import { log } from "../../shared/logger"

export interface ResolveCategoryConfigOptions {
  userCategories?: CategoriesConfig
  inheritedModel?: string
  systemDefaultModel?: string
  availableModels?: Set<string>
  /** Global prompt append applied before category-specific prompt_append. Supports file:// URIs. */
  globalPromptAppend?: string
}

export interface ResolveCategoryConfigResult {
  config: CategoryConfig
  promptAppend: string
  model: string | undefined
  isUserConfiguredModel: boolean
}

/**
 * Resolve the configuration for a given category name.
 * Merges default and user configurations, handles model resolution.
 */
export function resolveCategoryConfig(
  categoryName: string,
  options: ResolveCategoryConfigOptions
): ResolveCategoryConfigResult | null {
  const { userCategories, inheritedModel: _inheritedModel, systemDefaultModel, availableModels, globalPromptAppend } = options

  const defaultConfig = DEFAULT_CATEGORIES[categoryName]
  const userConfig = userCategories?.[categoryName]
  const hasExplicitUserConfig = userConfig !== undefined

  if (userConfig?.disable) {
    return null
  }

  const categoryReq = CATEGORY_MODEL_REQUIREMENTS[categoryName]
  if (categoryReq?.requiresModel && availableModels && !hasExplicitUserConfig) {
    if (!isModelAvailable(categoryReq.requiresModel, availableModels)) {
      log(`[resolveCategoryConfig] Category ${categoryName} requires ${categoryReq.requiresModel} but not available`)
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

  // Build promptAppend chain: global → category-default → user-specific
  const resolvedGlobal = globalPromptAppend
    ? resolvePromptAppend(globalPromptAppend, undefined, true /* allowOutsideProject */)
    : ""
  let promptAppend = resolvedGlobal

  const appendLayer = (existing: string, next: string): string => {
    return existing && next ? existing + "\n\n" + next : existing || next
  }

  if (defaultPromptAppend) {
    promptAppend = appendLayer(promptAppend, defaultPromptAppend)
  }
  if (userConfig?.prompt_append) {
    promptAppend = appendLayer(promptAppend, userConfig.prompt_append)
  }

  return { config, promptAppend, model, isUserConfiguredModel }
}

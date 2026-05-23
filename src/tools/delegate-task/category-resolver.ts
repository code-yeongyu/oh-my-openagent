import type { ModelFallbackInfo } from "../../features/task-toast-manager/types"
import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import type { FallbackEntry } from "../../shared/model-requirements"
import { mergeCategories } from "../../shared/merge-categories"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { resolveCategoryConfig } from "./categories"
import { CATEGORY_PROMPT_APPEND_RESOLVERS } from "./constants"
import { parseModelString } from "../../shared/model-string-parser"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { normalizeFallbackModels, flattenToFallbackModelStrings } from "../../shared/model-resolver"
import { buildFallbackChainFromModels, findMostSpecificFallbackEntry } from "../../shared/fallback-chain-from-models"
import { CONFIG_BASENAME } from "../../shared/plugin-identity"
import { getAvailableModelsForDelegateTask } from "./available-models"
import { resolveModelForDelegateTask } from "./model-selection"
import { filterDisabledProvidersFromFallbackChain, isModelProviderDisabled, validateRuntimeModelProvider } from "./runtime-model-policy"

import type { CategoryConfig } from "../../config/schema"
import type { DelegatedModelConfig } from "./types"

function applyCategoryParams(base: DelegatedModelConfig, config: CategoryConfig): DelegatedModelConfig {
  const result = { ...base }
  if (config.temperature !== undefined) result.temperature = config.temperature
  if (config.top_p !== undefined) result.top_p = config.top_p
  if (config.maxTokens !== undefined) result.maxTokens = config.maxTokens
  if (config.reasoningEffort !== undefined) result.reasoningEffort = config.reasoningEffort
  if (config.thinking !== undefined) result.thinking = config.thinking
  return result
}

function resolveCategoryPromptAppendForModel(
  categoryName: string,
  actualModel: string | undefined,
  staticPromptAppend: string,
  userPromptAppend: string | undefined,
): string | undefined {
  const dynamicResolver = CATEGORY_PROMPT_APPEND_RESOLVERS[categoryName]
  if (!dynamicResolver) {
    return staticPromptAppend || undefined
  }
  const dynamicBase = dynamicResolver(actualModel)
  if (!userPromptAppend) {
    return dynamicBase || undefined
  }
  return dynamicBase ? `${dynamicBase}\n\n${userPromptAppend}` : userPromptAppend
}

export interface CategoryResolutionResult {
  agentToUse: string
  categoryModel: DelegatedModelConfig | undefined
  categoryPromptAppend: string | undefined
  maxPromptTokens?: number
  modelInfo: ModelFallbackInfo | undefined
  actualModel: string | undefined
  isUnstableAgent: boolean
  fallbackChain?: FallbackEntry[]  // For runtime retry on model errors
  error?: string
}

export async function resolveCategoryExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  inheritedModel: string | undefined,
  systemDefaultModel: string | undefined
): Promise<CategoryResolutionResult> {
  const { client, userCategories, sisyphusJuniorModel } = executorCtx

  const categoryName = args.category!
  const enabledCategories = mergeCategories(userCategories)
  const categoryExists = enabledCategories[categoryName] !== undefined

  if (!categoryExists) {
    const allCategoryNames = Object.keys(enabledCategories).join(", ")
    return {
      agentToUse: "",
      categoryModel: undefined,
      categoryPromptAppend: undefined,
      maxPromptTokens: undefined,
      modelInfo: undefined,
      actualModel: undefined,
      isUnstableAgent: false,
      error: `Unknown category: "${categoryName}". Available: ${allCategoryNames}`,
    }
  }

  const availableModels = await getAvailableModelsForDelegateTask(client)

  const resolved = resolveCategoryConfig(categoryName, {
    userCategories,
    inheritedModel,
    systemDefaultModel,
    availableModels,
  })

  if (!resolved) {
    const requirement = CATEGORY_MODEL_REQUIREMENTS[categoryName]
    const allCategoryNames = Object.keys(enabledCategories).join(", ")

    if (categoryExists && requirement?.requiresModel) {
      return {
        agentToUse: "",
        categoryModel: undefined,
        categoryPromptAppend: undefined,
        maxPromptTokens: undefined,
        modelInfo: undefined,
        actualModel: undefined,
        isUnstableAgent: false,
        error: `Category "${categoryName}" requires model "${requirement.requiresModel}" which is not available.

To use this category:
1. Connect a provider with this model: ${requirement.requiresModel}
2. Or configure an alternative model in your ${CONFIG_BASENAME}.json for this category

Available categories: ${allCategoryNames}`,
      }
    }

    return {
      agentToUse: "",
      categoryModel: undefined,
      categoryPromptAppend: undefined,
      maxPromptTokens: undefined,
      modelInfo: undefined,
      actualModel: undefined,
      isUnstableAgent: false,
      error: `Unknown category: "${categoryName}". Available: ${allCategoryNames}`,
    }
  }

  const requirement = CATEGORY_MODEL_REQUIREMENTS[args.category!]
  const requirementFallbackChain = filterDisabledProvidersFromFallbackChain(requirement?.fallbackChain, executorCtx.disabledProviders)
  const normalizedConfiguredFallbackModels = normalizeFallbackModels(resolved.config.fallback_models)
  let actualModel: string | undefined
  let modelInfo: ModelFallbackInfo | undefined
  let categoryModel: DelegatedModelConfig | undefined
  let isModelResolutionSkipped = false
  let fallbackEntry: FallbackEntry | undefined
  let matchedFallback = false

  const runtimeModel = args.model?.trim() || undefined
  const runtimeVariant = args.variant?.trim() || undefined
  const runtimeModelVariant = runtimeModel ? parseModelString(runtimeModel)?.variant : undefined
  const runtimeModelError = validateRuntimeModelProvider(runtimeModel, executorCtx.disabledProviders)
  if (runtimeModelError) {
    return {
      agentToUse: "",
      categoryModel: undefined,
      categoryPromptAppend: undefined,
      maxPromptTokens: undefined,
      modelInfo: undefined,
      actualModel: undefined,
      isUnstableAgent: false,
      error: runtimeModelError,
    }
  }
  const overrideModel = sisyphusJuniorModel
  const explicitCategoryModel = userCategories?.[args.category!]?.model
  const userModelOverride = runtimeModel ?? explicitCategoryModel ?? overrideModel

  if (!requirement) {
    // Precedence: runtime model > explicit category model > sisyphus-junior default > category resolved model
    // This keeps `sisyphus-junior.model` useful as a global default while allowing
    // per-invocation and per-category overrides to beat that global default.
    actualModel = userModelOverride ?? resolved.model
    if (actualModel) {
      modelInfo = userModelOverride
        ? { model: actualModel, type: "user-defined", source: "override" }
        : { model: actualModel, type: "system-default", source: "system-default" }
      const parsedModel = parseModelString(actualModel)
      const variantToUse = runtimeVariant ?? runtimeModelVariant ?? userCategories?.[args.category!]?.variant ?? resolved.config.variant
      categoryModel = parsedModel
        ? applyCategoryParams({ ...parsedModel, variant: variantToUse ?? parsedModel.variant }, resolved.config)
        : undefined
    }
  } else {
    const resolution = resolveModelForDelegateTask({
      userModel: userModelOverride,
      userFallbackModels: flattenToFallbackModelStrings(normalizedConfiguredFallbackModels),
      categoryDefaultModel: resolved.model,
      isUserConfiguredCategoryModel: resolved.isUserConfiguredModel,
      fallbackChain: requirementFallbackChain,
      availableModels,
      systemDefaultModel,
      disabledProviders: executorCtx.disabledProviders,
    })

    if (resolution && "skipped" in resolution) {
      isModelResolutionSkipped = true
      if (userModelOverride) {
        actualModel = userModelOverride
        const parsedModel = parseModelString(userModelOverride)
        const variantToUse = runtimeVariant ?? runtimeModelVariant ?? userCategories?.[args.category!]?.variant ?? resolved.config.variant
        categoryModel = parsedModel
          ? applyCategoryParams({ ...parsedModel, variant: variantToUse ?? parsedModel.variant }, resolved.config)
          : undefined
        modelInfo = { model: userModelOverride, type: "user-defined", source: "override" }
      }
    } else if (resolution) {
      const {
        model: resolvedModel,
        variant: resolvedVariant,
        fallbackEntry: resolvedFallbackEntry,
        matchedFallback: resolvedMatchedFallback,
      } = resolution
      fallbackEntry = resolvedFallbackEntry
      matchedFallback = resolvedMatchedFallback === true
      actualModel = resolvedModel

      if (!parseModelString(actualModel)) {
        return {
          agentToUse: "",
          categoryModel: undefined,
          categoryPromptAppend: undefined,
          maxPromptTokens: undefined,
          modelInfo: undefined,
          actualModel: undefined,
          isUnstableAgent: false,
          error: `Invalid model format "${actualModel}". Expected "provider/model" format (e.g., "anthropic/claude-sonnet-4-6").`,
        }
      }

      const type: "user-defined" | "inherited" | "category-default" | "system-default" =
        userModelOverride
          ? "user-defined"
          : (systemDefaultModel && actualModel === systemDefaultModel)
              ? "system-default"
              : "category-default"

      const source: "override" | "category-default" | "system-default" =
        type === "user-defined"
          ? "override"
          : type === "system-default"
              ? "system-default"
              : "category-default"

      modelInfo = { model: actualModel, type, source }

      const parsedModel = parseModelString(actualModel)
      const variantToUse = runtimeVariant ?? runtimeModelVariant ?? userCategories?.[args.category!]?.variant ?? resolvedVariant ?? resolved.config.variant
      categoryModel = parsedModel
        ? applyCategoryParams({ ...parsedModel, variant: variantToUse ?? parsedModel.variant }, resolved.config)
        : undefined
    }
  }

  if (!categoryModel && actualModel) {
    const parsedModel = parseModelString(actualModel)
    categoryModel = parsedModel ?? undefined
  }

  if (isModelProviderDisabled(actualModel, executorCtx.disabledProviders)) {
    const provider = actualModel ? parseModelString(actualModel)?.providerID : undefined
    return {
      agentToUse: "",
      categoryModel: undefined,
      categoryPromptAppend: undefined,
      maxPromptTokens: undefined,
      modelInfo: undefined,
      actualModel: undefined,
      isUnstableAgent: false,
      error: provider
        ? `Resolved category model "${actualModel}" uses disabled provider "${provider}". Remove the category model or remove "${provider}" from disabled_providers.`
        : `Resolved category model uses a disabled provider. Remove the category model or update disabled_providers.`,
    }
  }

  const categoryPromptAppend = resolveCategoryPromptAppendForModel(
    args.category!,
    actualModel,
    resolved.promptAppend,
    userCategories?.[args.category!]?.prompt_append,
  )

  if (!categoryModel && !actualModel && !isModelResolutionSkipped) {
    const categoryNames = Object.keys(enabledCategories)
    return {
      agentToUse: "",
      categoryModel: undefined,
      categoryPromptAppend: undefined,
      maxPromptTokens: undefined,
      modelInfo: undefined,
      actualModel: undefined,
      isUnstableAgent: false,
      error: `Model not configured for category "${args.category}".

Configure in one of:
1. OpenCode: Set "model" in opencode.json
2. Oh-My-OpenCode: Set category model in ${CONFIG_BASENAME}.json
3. Provider: Connect a provider with available models

Current category: ${args.category}
Available categories: ${categoryNames.join(", ")}`,
    }
  }

  const resolvedModel = actualModel?.toLowerCase()
  const isUnstableAgent = resolved.config.is_unstable_agent ?? (resolvedModel ? resolvedModel.includes("gemini") || resolvedModel.includes("minimax") : false)

  const defaultProviderID = categoryModel?.providerID
    ?? parseModelString(actualModel ?? "")?.providerID
    ?? "opencode"
  const configuredFallbackChain = filterDisabledProvidersFromFallbackChain(
    buildFallbackChainFromModels(
      normalizedConfiguredFallbackModels,
      defaultProviderID,
    ),
    executorCtx.disabledProviders,
  )

  // Only promote fallback-only settings when resolution actually selected a fallback model.
  const effectiveEntry = matchedFallback && categoryModel
    ? (
        fallbackEntry
        ?? (configuredFallbackChain
          ? findMostSpecificFallbackEntry(categoryModel.providerID, categoryModel.modelID, configuredFallbackChain)
          : undefined)
      )
    : undefined

  if (categoryModel && effectiveEntry) {
    categoryModel = {
      ...categoryModel,
      variant: runtimeVariant ?? runtimeModelVariant ?? userCategories?.[args.category!]?.variant ?? effectiveEntry.variant ?? categoryModel.variant,
      reasoningEffort: effectiveEntry.reasoningEffort ?? categoryModel.reasoningEffort,
      temperature: effectiveEntry.temperature ?? categoryModel.temperature,
      top_p: effectiveEntry.top_p ?? categoryModel.top_p,
      maxTokens: effectiveEntry.maxTokens ?? categoryModel.maxTokens,
      thinking: effectiveEntry.thinking ?? categoryModel.thinking,
    }
  }

  return {
    agentToUse: SISYPHUS_JUNIOR_AGENT,
    categoryModel,
    categoryPromptAppend,
    maxPromptTokens: resolved.config.max_prompt_tokens,
    modelInfo,
    actualModel,
    isUnstableAgent,
    // Don't use hardcoded fallback chain when resolution was skipped (cold cache)
    fallbackChain: configuredFallbackChain ?? ((isModelResolutionSkipped || userModelOverride) ? undefined : requirementFallbackChain),
  }
}

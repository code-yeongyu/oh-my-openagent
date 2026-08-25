import type { ModelFallbackInfo } from "../../features/task-toast-manager/types"
import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import type { FallbackEntry } from "../../shared/model-requirements"
import { mergeCategories } from "../../shared/merge-categories"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { resolveCategoryConfig } from "./categories"
import { BUILTIN_CATEGORY_REQUIRES_MODEL, CATEGORY_PROMPT_APPEND_RESOLVERS } from "./constants"
import { parseModelString } from "../../shared/model-string-parser"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { normalizeFallbackModels, flattenToFallbackModelStrings } from "../../shared/model-resolver"
import { buildFallbackChainFromModels, findMostSpecificFallbackEntry } from "../../shared/fallback-chain-from-models"
import { getAvailableModelsForDelegateTask } from "./available-models"
import { resolveModelForDelegateTask } from "./model-selection"
import type { DelegatedModelConfig } from "./types"
import { applyCategoryParams } from "./delegated-model-config"
import { applyFallbackEntrySettings } from "./fallback-entry-settings"

function getConfiguredModel(entry: string | { model: string } | undefined): string | undefined {
  return typeof entry === "string" ? entry : entry?.model
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

function categoryResolutionError(error: string): CategoryResolutionResult {
  return {
    agentToUse: "",
    categoryModel: undefined,
    categoryPromptAppend: undefined,
    maxPromptTokens: undefined,
    modelInfo: undefined,
    actualModel: undefined,
    isUnstableAgent: false,
    error,
  }
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
    return categoryResolutionError(`Unknown category: "${categoryName}". Available: ${allCategoryNames}`)
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
    const requiredModel = requirement?.requiresModel ?? BUILTIN_CATEGORY_REQUIRES_MODEL[categoryName]
    const allCategoryNames = Object.keys(enabledCategories).join(", ")
    const configuredModels = userCategories?.[categoryName]?.models

    if (configuredModels && availableModels.size > 0) {
      const configuredChain = configuredModels.map((entry) => getConfiguredModel(entry)).join(" -> ")
      return categoryResolutionError(`Configured model chain is unavailable for category "${categoryName}": ${configuredChain}`)
    }

    if (categoryExists && requiredModel) {
      return categoryResolutionError(`Category "${categoryName}" requires model "${requiredModel}" which is not available.

To use this category:
1. Connect a provider with this model: ${requiredModel}
2. Or configure an alternative model in your .omo/omo.jsonc for this category

Available categories: ${allCategoryNames}`)
    }

    return categoryResolutionError(`Unknown category: "${categoryName}". Available: ${allCategoryNames}`)
  }

  const requirement = CATEGORY_MODEL_REQUIREMENTS[args.category!]
  const hasCanonicalModels = resolved.config.models !== undefined
  const canonicalPrimaryEntry = resolved.config.models?.[0]
  const configuredPrimaryModel = getConfiguredModel(canonicalPrimaryEntry)
  const categoryResolvedModel = hasCanonicalModels ? configuredPrimaryModel : resolved.model
  const normalizedConfiguredFallbackModels = normalizeFallbackModels(
    hasCanonicalModels ? resolved.config.models?.slice(1) : resolved.config.fallback_models,
  )
  let actualModel: string | undefined
  let modelInfo: ModelFallbackInfo | undefined
  let categoryModel: DelegatedModelConfig | undefined
  let isModelResolutionSkipped = false
  let fallbackEntry: FallbackEntry | undefined
  let matchedFallback = false

  const overrideModel = sisyphusJuniorModel
  const explicitCategoryModel = hasCanonicalModels
    ? configuredPrimaryModel
    : userCategories?.[args.category!]?.model

  if (!requirement) {
    // Precedence: explicit category model > sisyphus-junior default > category resolved model
    // This keeps `sisyphus-junior.model` useful as a global default while allowing
    // per-category overrides via `categories[category].model`.
    actualModel = explicitCategoryModel ?? overrideModel ?? categoryResolvedModel
    if (actualModel) {
      modelInfo = explicitCategoryModel || overrideModel
        ? { model: actualModel, type: "user-defined", source: "override" }
        : { model: actualModel, type: "system-default", source: "system-default" }
      const parsedModel = parseModelString(actualModel)
      const variantToUse = userCategories?.[args.category!]?.variant ?? resolved.config.variant
      categoryModel = parsedModel
        ? applyCategoryParams({ ...parsedModel, variant: variantToUse ?? parsedModel.variant }, resolved.config)
        : undefined
    }
  } else {
    const resolution = resolveModelForDelegateTask({
      userModel: explicitCategoryModel ?? overrideModel,
      userFallbackModels: flattenToFallbackModelStrings(normalizedConfiguredFallbackModels),
      categoryDefaultModel: categoryResolvedModel,
      isUserConfiguredCategoryModel: hasCanonicalModels
        ? configuredPrimaryModel !== undefined
        : resolved.isUserConfiguredModel,
      fallbackChain: requirement.fallbackChain,
      availableModels,
      systemDefaultModel,
    })

    if (resolution && "skipped" in resolution) {
      isModelResolutionSkipped = true
      const userModelOverride = explicitCategoryModel ?? overrideModel
      if (userModelOverride) {
        actualModel = userModelOverride
        const parsedModel = parseModelString(userModelOverride)
        const variantToUse = userCategories?.[args.category!]?.variant ?? resolved.config.variant
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
        return categoryResolutionError(`Invalid model format "${actualModel}". Expected "provider/model" format (e.g., "anthropic/claude-sonnet-4-6").`)
      }

      const type: "user-defined" | "inherited" | "category-default" | "system-default" =
        (explicitCategoryModel || overrideModel)
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
      const variantToUse = userCategories?.[args.category!]?.variant ?? resolvedVariant ?? resolved.config.variant
      categoryModel = parsedModel
        ? applyCategoryParams({ ...parsedModel, variant: variantToUse ?? parsedModel.variant }, resolved.config)
        : undefined
    }
  }

  if (!categoryModel && actualModel) {
    const parsedModel = parseModelString(actualModel)
    categoryModel = parsedModel ?? undefined
  }
  const categoryPromptAppend = resolveCategoryPromptAppendForModel(
    args.category!,
    actualModel,
    resolved.promptAppend,
    userCategories?.[args.category!]?.prompt_append,
  )

  if (!categoryModel && !actualModel && !isModelResolutionSkipped) {
    const categoryNames = Object.keys(enabledCategories)
    return categoryResolutionError(`Model not configured for category "${args.category}".

Configure in one of:
1. OpenCode: Set "model" in opencode.json
2. Oh-My-OpenCode: Set category model in .omo/omo.jsonc
3. Provider: Connect a provider with available models

Current category: ${args.category}
Available categories: ${categoryNames.join(", ")}`)
  }

  const resolvedModel = actualModel?.toLowerCase()
  const isUnstableAgent = resolved.config.is_unstable_agent ?? (resolvedModel ? resolvedModel.includes("gemini") || resolvedModel.includes("minimax") : false)

  const defaultProviderID = categoryModel?.providerID
    ?? parseModelString(actualModel ?? "")?.providerID
    ?? "opencode"
  const configuredFallbackChain = buildFallbackChainFromModels(
    normalizedConfiguredFallbackModels,
    defaultProviderID,
  )
  const canonicalModelChain = hasCanonicalModels
    ? buildFallbackChainFromModels(resolved.config.models, defaultProviderID)
    : undefined

  // Canonical model entries carry settings for both the primary and fallback rungs.
  // Legacy fallback-only settings are promoted only when resolution selected a fallback.
  const effectiveEntry = categoryModel
    ? hasCanonicalModels
      ? (canonicalModelChain
          ? findMostSpecificFallbackEntry(categoryModel.providerID, categoryModel.modelID, canonicalModelChain)
          : undefined)
      : matchedFallback
        ? (
            fallbackEntry
            ?? (configuredFallbackChain
              ? findMostSpecificFallbackEntry(categoryModel.providerID, categoryModel.modelID, configuredFallbackChain)
              : undefined)
          )
        : undefined
    : undefined

  if (categoryModel && effectiveEntry) {
    categoryModel = applyFallbackEntrySettings({
      categoryModel,
      effectiveEntry,
      variantOverride: userCategories?.[args.category!]?.variant,
    })
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
    fallbackChain: configuredFallbackChain ?? ((isModelResolutionSkipped || explicitCategoryModel || overrideModel) ? undefined : requirement?.fallbackChain),
  }
}

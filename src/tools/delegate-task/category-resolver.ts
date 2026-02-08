import type { ModelFallbackInfo } from "../../features/task-toast-manager/types"
import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import { DEFAULT_CATEGORIES } from "./constants"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { resolveCategoryConfig } from "./categories"
import { parseModelString } from "./model-string-parser"
import { fetchAvailableModels } from "../../shared/model-availability"
import { readConnectedProvidersCache } from "../../shared/connected-providers-cache"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { resolveModelPipeline } from "../../shared"

export interface CategoryResolutionResult {
  agentToUse: string
  categoryModel: { providerID: string; modelID: string; variant?: string } | undefined
  categoryPromptAppend: string | undefined
  modelInfo: ModelFallbackInfo | undefined
  actualModel: string | undefined
  isUnstableAgent: boolean
  error?: string
}

export async function resolveCategoryExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  inheritedModel: string | undefined,
  systemDefaultModel: string | undefined
): Promise<CategoryResolutionResult> {
  const { client, userCategories, sisyphusJuniorModel } = executorCtx

  const connectedProviders = readConnectedProvidersCache()
  const availableModels = await fetchAvailableModels(client, {
    connectedProviders: connectedProviders ?? undefined,
  })

  const resolved = resolveCategoryConfig(args.category!, {
    userCategories,
    inheritedModel,
    systemDefaultModel,
    availableModels,
  })

  if (!resolved) {
    return {
      agentToUse: "",
      categoryModel: undefined,
      categoryPromptAppend: undefined,
      modelInfo: undefined,
      actualModel: undefined,
      isUnstableAgent: false,
      error: `Unknown category: "${args.category}". Available: ${Object.keys({ ...DEFAULT_CATEGORIES, ...userCategories }).join(", ")}`,
    }
  }

  const requirement = CATEGORY_MODEL_REQUIREMENTS[args.category!]
  let actualModel: string | undefined
  let modelInfo: ModelFallbackInfo | undefined
  let categoryModel: { providerID: string; modelID: string; variant?: string } | undefined

  const overrideModel = sisyphusJuniorModel
  const explicitCategoryModel = userCategories?.[args.category!]?.model

  if (!requirement) {
    // Precedence: explicit category model > sisyphus-junior default > category resolved model
    // This keeps `sisyphus-junior.model` useful as a global default while allowing
    // per-category overrides via `categories[category].model`.
    actualModel = explicitCategoryModel ?? overrideModel ?? resolved.model
    if (actualModel) {
      modelInfo = explicitCategoryModel || overrideModel
        ? { model: actualModel, type: "user-defined", source: "override" }
        : { model: actualModel, type: "system-default", source: "system-default" }
    }
  } else {
    const resolution = resolveModelPipeline({
      intent: {
        userModel: explicitCategoryModel ?? overrideModel,
        categoryDefaultModel: resolved.model,
      },
      constraints: { availableModels },
      policy: {
        fallbackChain: requirement.fallbackChain,
        systemDefaultModel,
      },
    })

    if (resolution) {
      const { model: resolvedModel, provenance, variant: resolvedVariant } = resolution
      actualModel = resolvedModel

      if (!parseModelString(actualModel)) {
        return {
          agentToUse: "",
          categoryModel: undefined,
          categoryPromptAppend: undefined,
          modelInfo: undefined,
          actualModel: undefined,
          isUnstableAgent: false,
          error: `Invalid model format "${actualModel}". Expected "provider/model" format (e.g., "anthropic/claude-sonnet-4-5").`,
        }
      }

      let type: "user-defined" | "inherited" | "category-default" | "system-default"
      const source = provenance
      switch (provenance) {
        case "override":
          type = "user-defined"
          break
        case "category-default":
        case "provider-fallback":
          type = "category-default"
          break
        case "system-default":
          type = "system-default"
          break
      }

      modelInfo = { model: actualModel, type, source }

      const parsedModel = parseModelString(actualModel)
      const variantToUse = userCategories?.[args.category!]?.variant ?? resolvedVariant ?? resolved.config.variant
      categoryModel = parsedModel
        ? (variantToUse ? { ...parsedModel, variant: variantToUse } : parsedModel)
        : undefined
    }
  }

  if (!categoryModel && actualModel) {
    const parsedModel = parseModelString(actualModel)
    categoryModel = parsedModel ?? undefined
  }
  const categoryPromptAppend = resolved.promptAppend || undefined

  if (!categoryModel && !actualModel) {
    const categoryNames = Object.keys({ ...DEFAULT_CATEGORIES, ...userCategories })
    return {
      agentToUse: "",
      categoryModel: undefined,
      categoryPromptAppend: undefined,
      modelInfo: undefined,
      actualModel: undefined,
      isUnstableAgent: false,
      error: `Model not configured for category "${args.category}".

Configure in one of:
1. OpenCode: Set "model" in opencode.json
2. Oh-My-OpenCode: Set category model in oh-my-opencode.json
3. Provider: Connect a provider with available models

Current category: ${args.category}
Available categories: ${categoryNames.join(", ")}`,
    }
  }

  const unstableModel = actualModel?.toLowerCase()
  const isUnstableAgent = resolved.config.is_unstable_agent === true || (unstableModel ? unstableModel.includes("gemini") || unstableModel.includes("minimax") : false)

  return {
    agentToUse: SISYPHUS_JUNIOR_AGENT,
    categoryModel,
    categoryPromptAppend,
    modelInfo,
    actualModel,
    isUnstableAgent,
  }
}

import { canonicalCategoryName } from "@oh-my-opencode/omo-config-core"
import type { ModelProvider } from "../../config/schema/provider-models"
import { getAgentConfigKey } from "../../shared/agent-display-names"
import { mergeCategories } from "../../shared/merge-categories"
import { resolveProviderModelPin } from "../../shared/provider-model-pin"
import { resolveCategoryConfig } from "./categories"
import {
  categoryResolutionError,
  resolveCategoryPromptAppendForModel,
  type CategoryResolutionResult,
} from "./category-resolver"
import type { ExecutorContext } from "./executor-types"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import type { DelegatedModelConfig, DelegateTaskArgs } from "./types"

/**
 * task(category, provider): the provider's category pin replaces every other model source
 * (category model, Junior pin, builtin default, fallback chain). The category still supplies
 * its prompt append, prompt budget and tool permissions.
 */
export function resolvePinnedCategoryExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  provider: ModelProvider,
): CategoryResolutionResult {
  const enabledCategories = mergeCategories(executorCtx.userCategories)
  const requestedCategoryName = args.category ?? ""
  const categoryName =
    enabledCategories[requestedCategoryName] !== undefined
      ? requestedCategoryName
      : canonicalCategoryName(requestedCategoryName)
  const resolved =
    enabledCategories[categoryName] !== undefined
      ? resolveCategoryConfig(categoryName, { userCategories: executorCtx.userCategories })
      : null
  if (!resolved) {
    const allCategoryNames = Object.keys(enabledCategories).join(", ")
    return categoryResolutionError(`Unknown category: "${categoryName}". Available: ${allCategoryNames}`)
  }

  const pin = resolveProviderModelPin(executorCtx.providerModels, provider, "categories", categoryName)
  if ("error" in pin) {
    return categoryResolutionError(pin.error)
  }

  const actualModel = `${pin.model.providerID}/${pin.model.modelID}`
  const categoryModel: DelegatedModelConfig = {
    ...pin.model,
    ...(resolved.config.tools !== undefined ? { tools: resolved.config.tools } : {}),
  }
  return {
    agentToUse: SISYPHUS_JUNIOR_AGENT,
    categoryModel,
    categoryPromptAppend: resolveCategoryPromptAppendForModel(
      categoryName,
      actualModel,
      resolved.promptAppend,
      executorCtx.userCategories?.[categoryName]?.prompt_append,
    ),
    maxPromptTokens: resolved.config.max_prompt_tokens,
    modelInfo: { model: actualModel, type: "user-defined", source: "override" },
    actualModel,
    isUnstableAgent: resolved.config.is_unstable_agent ?? false,
    fallbackChain: undefined,
  }
}

/** task(subagent_type, provider): the provider's agent pin is the only model source. */
export function resolvePinnedSubagentModel(
  agentToUse: string,
  executorCtx: ExecutorContext,
  provider: ModelProvider,
): { readonly categoryModel: DelegatedModelConfig } | { readonly error: string } {
  const pin = resolveProviderModelPin(executorCtx.providerModels, provider, "agents", getAgentConfigKey(agentToUse))
  return "error" in pin ? pin : { categoryModel: pin.model }
}

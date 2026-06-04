import type { DelegateTaskArgs } from "./types"
import type { ExecutorContext } from "./executor-types"
import type { DelegatedModelConfig } from "./types"
import { isPlanAgent, isPlanFamily, isCoordinatorAgent, COORDINATOR_AGENT_NAMES } from "./constants"
import { SISYPHUS_JUNIOR_AGENT } from "./sisyphus-junior-agent"
import { applyCategoryParams } from "./delegated-model-config"
import { getAvailableModelsForDelegateTask } from "./available-models"
import { resolveEffectiveFallbackEntry } from "./fallback-entry-resolution"
import { applyFallbackEntrySettings } from "./fallback-entry-settings"
import type { AgentInfo } from "./subagent-discovery"
import {
  findPrimaryAgentMatch,
  findCallableAgentMatch,
  sanitizeSubagentType,
  listCallableAgentNames,
  mergeWithClaudeCodeAgents,
  isDemotedPlanAgent,
} from "./subagent-discovery"
import type { FallbackEntry } from "../../shared/model-requirements"
import { AGENT_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import { resolveModelForDelegateTask } from "./model-selection"
import { fuzzyMatchModel } from "../../shared/model-availability"
import { getAgentConfigKey, stripAgentListSortPrefix } from "../../shared/agent-display-names"
import { buildFallbackChainFromModels } from "../../shared/fallback-chain-from-models"
import { normalizeSDKResponse } from "../../shared"
import { normalizeModelFormat } from "../../shared/model-format-normalizer"
import { flattenToFallbackModelStrings, normalizeFallbackModels } from "../../shared/model-resolver"
import { log } from "../../shared/logger"

const DEFAULT_PLAN_FALLBACK_AGENT = "plan"
const RESERVED_HIDDEN_NATIVE_AGENTS = new Set(["build"])

function isReservedHiddenNativeAgent(agentName: string): boolean {
  return RESERVED_HIDDEN_NATIVE_AGENTS.has(getAgentConfigKey(agentName))
}

function shouldUseHiddenPlanAgent(
  requestedAgent: string,
  serverPrimaryAgent: AgentInfo | undefined,
  serverMatchedAgent: AgentInfo | undefined,
  sisyphusAgentConfig: ExecutorContext["sisyphusAgentConfig"],
  hasDemotedPlan: boolean,
): boolean {
  if (serverPrimaryAgent) {
    return false
  }

  if (hasDemotedPlan) {
    return false
  }

  if (serverMatchedAgent) {
    return false
  }

  if (!isPlanAgent(requestedAgent)) {
    return false
  }

  return sisyphusAgentConfig?.planner_enabled !== false
    && sisyphusAgentConfig?.replace_plan !== false
}

export interface ResolveSubagentExecutionOptions {
  allowSisyphusJuniorDirect?: boolean
  allowPrimaryAgentDelegation?: boolean
}

export async function resolveSubagentExecution(
  args: DelegateTaskArgs,
  executorCtx: ExecutorContext,
  parentAgent: string | undefined,
  categoryExamples: string,
  options: ResolveSubagentExecutionOptions = {},
): Promise<{ agentToUse: string; categoryModel: DelegatedModelConfig | undefined; fallbackChain?: FallbackEntry[]; error?: string }> {
  const { client, agentOverrides, userCategories } = executorCtx

  if (!args.subagent_type?.trim()) {
    return { agentToUse: "", categoryModel: undefined, error: `Agent name cannot be empty.` }
  }

  const agentName = sanitizeSubagentType(args.subagent_type)

  if (
    !options.allowSisyphusJuniorDirect &&
    agentName.toLowerCase() === SISYPHUS_JUNIOR_AGENT.toLowerCase()
  ) {
    const exampleHint = categoryExamples.trim() !== ""
      ? `Use category parameter instead (e.g., ${categoryExamples}).`
      : `Use the category parameter instead (pick one of: quick, deep, ultrabrain, visual-engineering, artistry, writing).`
    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Cannot use subagent_type="${SISYPHUS_JUNIOR_AGENT}" directly. ${exampleHint}

Sisyphus-Junior is spawned automatically when you specify a category. Pick the appropriate category for your task domain.`,
    }
  }

  if (isPlanFamily(agentName) && isPlanFamily(parentAgent)) {
    return {
      agentToUse: "",
      categoryModel: undefined,
    error: `You are a plan-family agent (plan/prometheus). You cannot delegate to other plan-family agents via task.

Create the work plan directly - that's your job as the planning agent.`,
    }
  }

  if (isCoordinatorAgent(agentName)) {
    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Cannot delegate to coordinator agent "${agentName}" via task(). Coordinator agents (${COORDINATOR_AGENT_NAMES.join(", ")}) own the orchestration loop and must not be used as subagent targets — doing so creates duplicate coordinators and conflicting team state. Select a worker agent (e.g., sisyphus-junior via category, hephaestus, oracle) instead.`,
    }
  }

  let agentToUse = agentName
  let categoryModel: DelegatedModelConfig | undefined
  let fallbackChain: FallbackEntry[] | undefined

  try {
    const agentsResult = await client.app.agents()
    const agents = normalizeSDKResponse(agentsResult, [] as AgentInfo[], {
      preferResponseOnMissingData: true,
    })
    const hasDemotedPlan = agents.some(isDemotedPlanAgent)
    const serverPrimaryAgent = findPrimaryAgentMatch(agents, agentToUse)
    const serverMatchedAgent = findCallableAgentMatch(agents, agentToUse)

    const mergedAgents = mergeWithClaudeCodeAgents(agents, executorCtx.directory)
    const matchedPrimaryAgent = findPrimaryAgentMatch(mergedAgents, agentToUse)
    const useHiddenPlanFallback = shouldUseHiddenPlanAgent(
      agentToUse,
      serverPrimaryAgent,
      serverMatchedAgent,
      executorCtx.sisyphusAgentConfig,
      hasDemotedPlan,
    )

    if (isReservedHiddenNativeAgent(agentToUse) && !serverPrimaryAgent && !serverMatchedAgent) {
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Unknown agent: "${agentToUse}". Available agents: ${listCallableAgentNames(agents)}`,
      }
    }

    if (matchedPrimaryAgent && !options.allowPrimaryAgentDelegation && !useHiddenPlanFallback) {
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Cannot delegate to primary agent "${stripAgentListSortPrefix(matchedPrimaryAgent.name)}" via task. Select that agent directly instead.`,
      }
    }

    const usePrimary = options.allowPrimaryAgentDelegation && matchedPrimaryAgent !== undefined
    let matchedAgent = usePrimary
      ? matchedPrimaryAgent
      : findCallableAgentMatch(mergedAgents, agentToUse)

    if (useHiddenPlanFallback) {
      matchedAgent = {
        name: DEFAULT_PLAN_FALLBACK_AGENT,
        mode: "subagent",
      }
    }

    if (!matchedAgent) {
      return {
        agentToUse: "",
        categoryModel: undefined,
        error: `Unknown agent: "${agentToUse}". Available agents: ${listCallableAgentNames(mergedAgents)}`,
      }
    }

    agentToUse = usePrimary
      ? matchedAgent.name
      : stripAgentListSortPrefix(matchedAgent.name)

    const agentConfigKey = getAgentConfigKey(agentToUse)
    const agentOverride = agentOverrides?.[agentConfigKey as keyof typeof agentOverrides]
      ?? (agentOverrides ? Object.entries(agentOverrides).find(([key]) => key.toLowerCase() === agentConfigKey)?.[1] : undefined)
    const agentRequirement = AGENT_MODEL_REQUIREMENTS[agentConfigKey]
    const agentCategoryConfig = agentOverride?.category
      ? userCategories?.[agentOverride.category]
      : undefined
    const agentCategoryModel = agentCategoryConfig?.model
    const normalizedAgentFallbackModels = normalizeFallbackModels(
      agentOverride?.fallback_models
      ?? agentCategoryConfig?.fallback_models
    )

    const availableModels = await getAvailableModelsForDelegateTask(client)

    if (agentOverride?.model || agentCategoryModel || agentRequirement || matchedAgent.model) {

      const normalizedMatchedModel = matchedAgent.model
        ? normalizeModelFormat(matchedAgent.model)
        : undefined
      const matchedAgentModelStr = normalizedMatchedModel
        ? `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
        : undefined

      const resolution = resolveModelForDelegateTask({
        userModel: agentOverride?.model ?? agentCategoryModel,
        userFallbackModels: flattenToFallbackModelStrings(normalizedAgentFallbackModels),
        categoryDefaultModel: matchedAgentModelStr,
        fallbackChain: agentRequirement?.fallbackChain,
        availableModels,
        systemDefaultModel: undefined,
      })

      const resolutionSkipped = resolution && 'skipped' in resolution

      if (resolution && !resolutionSkipped) {
        const normalized = normalizeModelFormat(resolution.model)
        if (normalized) {
          const variantToUse = agentOverride?.variant ?? resolution.variant ?? agentCategoryConfig?.variant
          const resolvedModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
          categoryModel = applyCategoryParams(resolvedModel, agentCategoryConfig)
        }
      } else if (resolutionSkipped && (agentOverride?.model ?? agentCategoryModel)) {
        const explicitModel = agentOverride?.model ?? agentCategoryModel
        const normalized = explicitModel ? normalizeModelFormat(explicitModel) : undefined
        if (normalized) {
          const variantToUse = agentOverride?.variant ?? agentCategoryConfig?.variant
          const resolvedModel = variantToUse ? { ...normalized, variant: variantToUse } : normalized
          categoryModel = applyCategoryParams(resolvedModel, agentCategoryConfig)
          log("[delegate-task] Cold cache: using explicit user override for subagent", {
            agent: agentToUse,
            model: agentOverride?.model ?? agentCategoryModel,
          })
        }
      }

      const defaultProviderID = categoryModel?.providerID
        ?? normalizedMatchedModel?.providerID
        ?? "opencode"
      const configuredFallbackChain = buildFallbackChainFromModels(
        normalizedAgentFallbackModels,
        defaultProviderID,
      )
      fallbackChain = configuredFallbackChain ?? (resolutionSkipped ? undefined : agentRequirement?.fallbackChain)
      const effectiveEntry = resolveEffectiveFallbackEntry({
        categoryModel,
        configuredFallbackChain,
        resolution,
      })

      if (categoryModel && effectiveEntry) {
        categoryModel = applyFallbackEntrySettings({
          categoryModel,
          effectiveEntry,
          variantOverride: agentOverride?.variant,
        })
      }
    }

    if (!categoryModel && matchedAgent.model) {
      const normalizedMatchedModel = normalizeModelFormat(matchedAgent.model)
      if (normalizedMatchedModel) {
        const fullModel = `${normalizedMatchedModel.providerID}/${normalizedMatchedModel.modelID}`
        if (availableModels.size === 0 || fuzzyMatchModel(fullModel, availableModels, [normalizedMatchedModel.providerID])) {
          categoryModel = normalizedMatchedModel
        } else {
          log("[delegate-task] Skipping unavailable agent default model", {
            agent: agentToUse,
            model: fullModel,
          })
        }
      }
    }
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log("[delegate-task] Failed to resolve subagent execution", {
      requestedAgent: agentToUse,
      parentAgent,
      error: errorMessage,
    })

    return {
      agentToUse: "",
      categoryModel: undefined,
      error: `Failed to delegate to agent "${agentToUse}": ${errorMessage}`,
    }
  }

  return { agentToUse, categoryModel, fallbackChain }
}

import { stripAgentListSortPrefix } from "../../shared/agent-display-names"
import { resolveRegisteredAgentName } from "../claude-code-session-state"
import { applySessionPromptParams } from "../../shared/session-prompt-params-helpers"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import { estimateComplexity, resolveCategoryForComplexity, buildTierMapFromCategoryRequirements } from "@oh-my-opencode/delegate-core"
import { CATEGORY_MODEL_REQUIREMENTS } from "../../shared/model-requirements"
import type { RuntimeStateMember } from "./types"
import { log } from "../../shared/logger"

type PromptGenerationModel = {
  reasoningEffort?: string
  temperature?: number
  top_p?: number
  maxTokens?: number
  thinking?: { type: "enabled" | "disabled"; budgetTokens?: number }
}

export type TeamMemberPromptBody = {
  parts: Array<{ type: "text"; text: string }>
  agent?: string
  model?: { providerID: string; modelID: string }
  variant?: string
  temperature?: number
  topP?: number
  maxOutputTokens?: number
  options?: Record<string, unknown>
}

function buildPromptGenerationParams(model: PromptGenerationModel | undefined): Omit<TeamMemberPromptBody, "parts" | "agent" | "model" | "variant"> {
  if (!model) {
    return {}
  }

  const promptOptions: Record<string, unknown> = {
    ...(model.reasoningEffort ? { reasoningEffort: model.reasoningEffort } : {}),
    ...(model.thinking ? { thinking: model.thinking } : {}),
  }

  return {
    ...(model.temperature !== undefined ? { temperature: model.temperature } : {}),
    ...(model.top_p !== undefined ? { topP: model.top_p } : {}),
    ...(model.maxTokens !== undefined ? { maxOutputTokens: model.maxTokens } : {}),
    ...(Object.keys(promptOptions).length > 0 ? { options: promptOptions } : {}),
  }
}

export function applyMemberSessionRouting(
  sessionID: string,
  member: RuntimeStateMember,
  resolvedModel?: RuntimeStateMember["model"],
): void {
  if (member.category) {
    SessionCategoryRegistry.register(sessionID, member.category)
  }

  applySessionPromptParams(sessionID, resolvedModel ?? member.model)
}

export function buildMemberPromptBody(
  member: RuntimeStateMember,
  text: string,
  resolvedModel?: RuntimeStateMember["model"],
): TeamMemberPromptBody {
  const normalizedAgent = member.subagent_type ? stripAgentListSortPrefix(member.subagent_type) : undefined
  const launchAgent = resolveRegisteredAgentName(normalizedAgent) ?? normalizedAgent
  const effectiveModel = resolvedModel ?? member.model
  const model = effectiveModel
    ? {
        providerID: effectiveModel.providerID,
        modelID: effectiveModel.modelID,
      }
    : undefined

  return {
    ...(launchAgent ? { agent: launchAgent } : {}),
    ...(model ? { model } : {}),
    ...(effectiveModel?.variant ? { variant: effectiveModel.variant } : {}),
    ...buildPromptGenerationParams(effectiveModel),
    parts: [{ type: "text", text }],
  }
}

// ---- Dynamic per-message model resolution ----

/** Resolved model shape returned by resolveDynamicMemberModel. */
export type ResolvedDynamicModel = {
  providerID: string
  modelID: string
  variant?: string
}

/** Cached tier map built once from CATEGORY_MODEL_REQUIREMENTS. */
let _cachedTierMap: ReturnType<typeof buildTierMapFromCategoryRequirements> | undefined

function getTierMap() {
  if (!_cachedTierMap) {
    _cachedTierMap = buildTierMapFromCategoryRequirements(
      CATEGORY_MODEL_REQUIREMENTS as Record<string, { fallbackChain?: readonly { providers?: readonly string[]; model?: string }[] }>,
    )
  }
  return _cachedTierMap
}

/** Per-tier round-robin index for cross-provider distribution within team members. */
const memberRRCounters = new Map<string, number>()

/**
 * Re-resolve the model for a team member at message delivery time.
 *
 * When `modelResolutionMode === "dynamic"`:
 *   1. Estimates task complexity from the message content
 *   2. Maps complexity → best category via `resolveCategoryForComplexity`
 *   3. Looks up the category's fallback chain in `CATEGORY_MODEL_REQUIREMENTS`
 *   4. Picks a model via round-robin across providers in that chain
 *   5. Falls back to the member's creation-time model if resolution fails
 *
 * When `modelResolutionMode === "static"`, returns the member's current model.
 *
 * This means every message delivered to a dynamic team member gets a fresh
 * model selection based on what the task actually requires. Simple messages
 * get cheap models; complex messages get powerful models.
 */
export function resolveDynamicMemberModel(
  member: RuntimeStateMember,
  messageContent: string,
): ResolvedDynamicModel | undefined {
  const currentModel = member.model
  if (!currentModel) return undefined

  if (member.modelResolutionMode !== "dynamic") {
    return {
      providerID: currentModel.providerID,
      modelID: currentModel.modelID,
      variant: currentModel.variant,
    }
  }

  // 1. Estimate complexity from the task message
  const complexity = estimateComplexity(messageContent)

  // 2. Map complexity → best category for this tier
  const category = resolveCategoryForComplexity(complexity)

  // 3. Get tier map from CATEGORY_MODEL_REQUIREMENTS (cached)
  const tierMap = getTierMap()

  // 4. Select model via round-robin within the complexity tier
  const candidates = tierMap[complexity]
  if (candidates && candidates.length > 0) {
    const rrKey = `${member.name}:${complexity}`
    const current = memberRRCounters.get(rrKey) ?? 0
    const idx = current % candidates.length
    memberRRCounters.set(rrKey, current + 1)

    const picked = candidates[idx]
    if (picked) {
      log("[team-dynamic-model] model switched", {
        member: member.name,
        complexity,
        category,
        from: `${currentModel.providerID}/${currentModel.modelID}`,
        to: `${picked.provider}/${picked.model}`,
        rrIndex: idx,
        messagePreview: messageContent.slice(0, 80),
      })

      return {
        providerID: picked.provider,
        modelID: picked.model,
      }
    }
  }

  // 5. Fallback: use creation-time model
  log("[team-dynamic-model] fallback to static model", {
    member: member.name,
    complexity,
    category,
    model: `${currentModel.providerID}/${currentModel.modelID}`,
    reason: candidates && candidates.length === 0 ? "empty tier" : "no candidates",
  })

  return {
    providerID: currentModel.providerID,
    modelID: currentModel.modelID,
    variant: currentModel.variant,
  }
}

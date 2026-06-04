import { stripAgentListSortPrefix } from "../../shared/agent-display-names"
import { resolveRegisteredAgentName } from "../claude-code-session-state"
import { applySessionPromptParams } from "../../shared/session-prompt-params-helpers"
import { SessionCategoryRegistry } from "../../shared/session-category-registry"
import type { RuntimeStateMember } from "./types"

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

export function applyMemberSessionRouting(sessionID: string, member: RuntimeStateMember): void {
  if (member.category) {
    SessionCategoryRegistry.register(sessionID, member.category)
  }

  applySessionPromptParams(sessionID, member.model)
}

export function buildMemberPromptBody(member: RuntimeStateMember, text: string): TeamMemberPromptBody {
  const normalizedAgent = member.subagent_type ? stripAgentListSortPrefix(member.subagent_type) : undefined
  const launchAgent = resolveRegisteredAgentName(normalizedAgent) ?? normalizedAgent
  const model = member.model
    ? {
        providerID: member.model.providerID,
        modelID: member.model.modelID,
      }
    : undefined

  return {
    ...(launchAgent ? { agent: launchAgent } : {}),
    ...(model ? { model } : {}),
    ...(member.model?.variant ? { variant: member.model.variant } : {}),
    ...buildPromptGenerationParams(member.model),
    parts: [{ type: "text", text }],
  }
}

import type { AgentConfig } from "@opencode-ai/sdk"
import type { CouncilConfig, CouncilMemberConfig } from "../../config/schema/athena"
import { createCouncilMemberAgent } from "../athena/council-member-agent"
import { parseModelString } from "../../tools/delegate-task/model-string-parser"
import { log } from "../../shared/logger"

/** Prefix used for all dynamically-registered council member agent keys. */
export const COUNCIL_MEMBER_KEY_PREFIX = "Council: "

/**
 * Generates a stable agent registration key from a council member's name.
 */
function getCouncilMemberAgentKey(member: CouncilMemberConfig): string {
  return `${COUNCIL_MEMBER_KEY_PREFIX}${member.name}`
}

/**
 * Registers council members as individual subagent entries.
 * Each member becomes a separate agent callable via task(subagent_type="Council: <name>").
 * Returns a record of agent keys to configs and the list of registered keys.
 */
type SkippedMember = { name: string; reason: string }

export function registerCouncilMemberAgents(
  councilConfig: CouncilConfig
): { agents: Record<string, AgentConfig>; registeredKeys: string[]; skippedMembers: SkippedMember[] } {
  const agents: Record<string, AgentConfig> = {}
  const registeredKeys: string[] = []
  const skippedMembers: SkippedMember[] = []

  for (const member of councilConfig.members) {
    const parsed = parseModelString(member.model)
    if (!parsed) {
      skippedMembers.push({
        name: member.name,
        reason: `Invalid model format: '${member.model}' (expected 'provider/model-id')`,
      })
      log("[council-member-agents] Skipping member with invalid model", { model: member.model })
      continue
    }

    const key = getCouncilMemberAgentKey(member)

    if (agents[key]) {
      skippedMembers.push({
        name: member.name,
        reason: `Duplicate name: '${member.name}' already registered`,
      })
      log("[council-member-agents] Skipping duplicate council member name", {
        name: member.name,
        model: member.model,
        existingModel: agents[key].model ?? "unknown",
      })
      continue
    }

    const config = createCouncilMemberAgent(member.model)
    const description = `Council member: ${member.name} (${parsed.providerID}/${parsed.modelID}). Independent read-only code analyst for Athena council. (OhMyOpenCode)`

    agents[key] = {
      ...config,
      description,
      model: member.model,
      ...(member.variant ? { variant: member.variant } : {}),
      ...(member.temperature !== undefined ? { temperature: member.temperature } : {}),
    }

    registeredKeys.push(key)

    log("[council-member-agents] Registered council member agent", {
      key,
      model: member.model,
      variant: member.variant,
    })
  }

  if (registeredKeys.length < 2) {
    log("[council-member-agents] Fewer than 2 valid council members after model parsing — disabling council mode")
    return { agents: {}, registeredKeys: [], skippedMembers }
  }

  return { agents, registeredKeys, skippedMembers }
}

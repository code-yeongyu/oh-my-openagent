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
export function getCouncilMemberAgentKey(member: CouncilMemberConfig): string {
  return `${COUNCIL_MEMBER_KEY_PREFIX}${member.name}`
}

/**
 * Registers council members as individual subagent entries.
 * Each member becomes a separate agent callable via task(subagent_type="Council: <name>").
 * Returns a record of agent keys to configs and the list of registered keys.
 */
export function registerCouncilMemberAgents(
  councilConfig: CouncilConfig
): { agents: Record<string, AgentConfig>; registeredKeys: string[] } {
  const agents: Record<string, AgentConfig> = {}
  const registeredKeys: string[] = []

  for (const member of councilConfig.members) {
    const parsed = parseModelString(member.model)
    if (!parsed) {
      log("[council-member-agents] Skipping member with invalid model", { model: member.model })
      continue
    }

    const key = getCouncilMemberAgentKey(member)
    const config = createCouncilMemberAgent(member.model)

    const description = `Council member: ${member.name} (${member.model}). Independent read-only code analyst for Athena council. (OhMyOpenCode)`

    if (agents[key]) {
      log("[council-member-agents] Skipping duplicate council member name", {
        name: member.name,
        model: member.model,
        existingModel: agents[key].model ?? "unknown",
      })
      continue
    }

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
    return { agents: {}, registeredKeys: [] }
  }

  return { agents, registeredKeys }
}

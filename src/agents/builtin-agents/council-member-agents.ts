import type { AgentConfig } from "@opencode-ai/sdk"
import type { CouncilConfig, CouncilMemberConfig } from "../../config/schema/athena"
import { createCouncilMemberAgent, type CouncilMemberAgentMode } from "../athena"
import { parseModelString } from "../../tools/delegate-task/model-string-parser"
import { log } from "../../shared/logger"
import { normalizeMemberId } from "../../shared/member-id-normalizer"

/** Prefix used for all dynamically-registered council member agent keys. */
export const COUNCIL_MEMBER_KEY_PREFIX = "Council: "
export const ATHENA_JUNIOR_COUNCIL_MEMBER_KEY_PREFIX = "Athena-Junior Council: "

export function buildCouncilMemberAgentKey(
  memberName: string,
  keyPrefix = COUNCIL_MEMBER_KEY_PREFIX
): string {
  return `${keyPrefix}${memberName}`
}

/**
 * Generates a stable agent registration key from a council member's name.
 */
function getCouncilMemberAgentKey(
  member: CouncilMemberConfig,
  keyPrefix = COUNCIL_MEMBER_KEY_PREFIX
): string {
  const normalizedName = normalizeMemberId(member.name)
  return buildCouncilMemberAgentKey(normalizedName, keyPrefix)
}

/**
 * Registers council members as individual subagent entries.
 * Each member becomes a separate agent callable via task(subagent_type="Council: <name>").
 * Returns a record of agent keys to configs and the list of registered keys.
 */
type SkippedMember = { name: string; reason: string }

export function registerCouncilMemberAgents(
  councilConfig: CouncilConfig,
  mode: CouncilMemberAgentMode = "delegation",
  keyPrefix = COUNCIL_MEMBER_KEY_PREFIX
): { agents: Record<string, AgentConfig>; registeredKeys: string[]; skippedMembers: SkippedMember[] } {
  const agents: Record<string, AgentConfig> = {}
  const registeredKeys: string[] = []
  const skippedMembers: SkippedMember[] = []
  const registeredNamesNormalized = new Set<string>()

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

    const key = getCouncilMemberAgentKey(member, keyPrefix)
    const nameNormalized = normalizeMemberId(member.name)

    if (registeredNamesNormalized.has(nameNormalized)) {
      skippedMembers.push({
        name: member.name,
        reason: `Duplicate name: '${member.name}' already registered (normalized match)`,
      })
      log("[council-member-agents] Skipping duplicate council member name", {
        name: member.name,
        model: member.model,
      })
      continue
    }

    const config = createCouncilMemberAgent(member.model, mode)
    const description = `Council member: ${member.name} (${parsed.providerID}/${parsed.modelID}). Independent read-only code analyst for Athena council. (OhMyOpenCode)`

    agents[key] = {
      ...config,
      description,
      model: member.model,
      ...(member.variant ? { variant: member.variant } : {}),
      ...(member.temperature !== undefined ? { temperature: member.temperature } : {}),
    }

    registeredKeys.push(key)
    registeredNamesNormalized.add(nameNormalized)

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

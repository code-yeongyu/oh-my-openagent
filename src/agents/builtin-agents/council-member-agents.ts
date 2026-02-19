import type { AgentConfig } from "@opencode-ai/sdk"
import type { CouncilConfig, CouncilMemberConfig } from "../athena/types"
import { createCouncilMemberAgent } from "../athena/council-member-agent"
import { parseModelString } from "../athena/model-parser"
import { log } from "../../shared/logger"

/** Prefix used for all dynamically-registered council member agent keys. */
export const COUNCIL_MEMBER_KEY_PREFIX = "Council: "

const UPPERCASE_TOKENS = new Set(["gpt", "llm", "ai", "api"])

/**
 * Derives a human-friendly display name from a model string.
 * "anthropic/claude-opus-4-6" → "Claude Opus 4.6"
 * "openai/gpt-5.3-codex" → "GPT 5.3 Codex"
 */
function humanizeModelId(model: string): string {
  const modelId = model.includes("/") ? model.split("/").pop() ?? model : model
  const parts = modelId.split("-")
  const result: string[] = []

  for (let i = 0; i < parts.length; i++) {
    const part = parts[i]
    if (/^\d+$/.test(part)) {
      const versionParts = [part]
      while (i + 1 < parts.length && /^\d+$/.test(parts[i + 1])) {
        i++
        versionParts.push(parts[i])
      }
      result.push(versionParts.join("."))
    } else if (UPPERCASE_TOKENS.has(part.toLowerCase())) {
      result.push(part.toUpperCase())
    } else {
      result.push(part.charAt(0).toUpperCase() + part.slice(1))
    }
  }

  return result.join(" ")
}

/**
 * Generates a stable agent registration key from a council member config.
 * Uses the member's name if present, otherwise derives a friendly name from the model ID.
 */
export function getCouncilMemberAgentKey(member: CouncilMemberConfig): string {
  const displayName = member.name ?? humanizeModelId(member.model)
  return `${COUNCIL_MEMBER_KEY_PREFIX}${displayName}`
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

    const friendlyName = member.name ?? humanizeModelId(member.model)
    const description = `Council member: ${friendlyName} (${member.model}). Independent read-only code analyst for Athena council. (OhMyOpenCode)`

    agents[key] = {
      ...config,
      description,
      model: member.model,
      ...(member.variant ? { variant: member.variant } : {}),
    }

    registeredKeys.push(key)

    log("[council-member-agents] Registered council member agent", {
      key,
      model: member.model,
      variant: member.variant,
    })
  }

  return { agents, registeredKeys }
}

import type { AgentPromptMetadata } from "./types"
import { truncateDescription } from "../shared/truncate-description"

type RegisteredAgentSummary = {
  name: string
  description: string
}

function sanitizeMarkdownTableCell(value: string): string {
  return value
    .replace(/\r?\n/g, " ")
    .replace(/\|/g, "\\|")
    .replace(/\s+/g, " ")
    .trim()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

export function parseRegisteredAgentSummaries(input: unknown): RegisteredAgentSummary[] {
  if (!Array.isArray(input)) return []

  const result: RegisteredAgentSummary[] = []
  for (const item of input) {
    if (!isRecord(item)) continue

    const name = typeof item.name === "string" ? item.name : undefined
    if (!name) continue

    const hidden = item.hidden
    if (hidden === true) continue

    const disabled = item.disabled
    if (disabled === true) continue

    const enabled = item.enabled
    if (enabled === false) continue

    const description = typeof item.description === "string" ? item.description : ""
    result.push({ name: sanitizeMarkdownTableCell(name), description: sanitizeMarkdownTableCell(description) })
  }

  return result
}

export function buildCustomAgentMetadata(agentName: string, description: string): AgentPromptMetadata {
  const shortDescription = sanitizeMarkdownTableCell(truncateDescription(description))
  const safeAgentName = sanitizeMarkdownTableCell(agentName)

  return {
    category: "specialist",
    cost: "CHEAP",
    triggers: [
      {
        domain: `Custom agent: ${safeAgentName}`,
        trigger: shortDescription || "Use when this agent's description matches the task",
      },
    ],
  }
}

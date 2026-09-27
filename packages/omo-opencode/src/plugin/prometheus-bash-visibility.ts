import { isRecord } from "@oh-my-opencode/utils"
import { isPrometheusAgent } from "../hooks/prometheus-md-only/agent-matcher"
import { getAgentDisplayName, stripAgentListSortPrefix } from "../shared/agent-display-names"

export type AgentDisplayNameOverrides = Record<string, { displayName?: string } | undefined>

// OpenCode drops a tool from the provider request only when the last permission rule for it is a
// blanket `"*": "deny"`. A deny scoped to a pattern that matches every command keeps `bash` in the
// request while OpenCode's permission check still refuses each call.
export const PROMETHEUS_BASH_PERMISSION = { "**": "deny" } as const

// OpenCode's Zen free tier rejects any request without the `bash` tool, so Prometheus keeps it there.
// Everywhere else the per-message tool switch, which OpenCode applies after chat.params, hides it as before.
export function hidePrometheusBashOutsideZenFree(input: unknown, agentOverrides?: AgentDisplayNameOverrides): void {
  if (!isRecord(input) || !isRecord(input.message)) return
  if (!isConfiguredPrometheusAgent(readAgentName(input.agent), agentOverrides)) return
  if (isOpenCodeZenFreeModel(input.model)) return

  const tools = isRecord(input.message.tools) ? input.message.tools : {}
  input.message.tools = { ...tools, bash: false }
}

export function isConfiguredPrometheusAgent(
  agentName: string | undefined,
  overrides: AgentDisplayNameOverrides | undefined,
): boolean {
  if (isPrometheusAgent(agentName)) return true
  if (agentName === undefined) return false
  const displayName = getAgentDisplayName("prometheus", overrides)
  return stripAgentListSortPrefix(agentName).trim().toLowerCase() === displayName.trim().toLowerCase()
}

function readAgentName(agent: unknown): string | undefined {
  if (typeof agent === "string") return agent
  if (isRecord(agent) && typeof agent.name === "string") return agent.name
  return undefined
}

// Same rule OpenCode uses to keep models usable without a Zen key: provider `opencode`, zero input cost.
function isOpenCodeZenFreeModel(model: unknown): boolean {
  return isRecord(model) && model.providerID === "opencode" && isRecord(model.cost) && model.cost.input === 0
}

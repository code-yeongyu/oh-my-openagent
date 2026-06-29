import type { OhMyOpenCodeConfig } from "../config"
import { log } from "../shared"
import { getAgentConfigKey } from "../shared/agent-display-names"
import { agentByKey } from "./agent-permission-lookup"

const EXTERNAL_MCP_DEFAULT_DENY_PATTERNS = ["codegraph_*"] as const
const EXTERNAL_MCP_ALLOWED_PATTERNS = new Set<string>(EXTERNAL_MCP_DEFAULT_DENY_PATTERNS)
const EXTERNAL_MCP_ELIGIBLE_SUBAGENT_KEYS = new Set(["explore", "librarian", "oracle"])

export function getExternalMcpDefaultToolDenials(): Record<string, false> {
  const denials: Record<string, false> = {}
  for (const pattern of EXTERNAL_MCP_DEFAULT_DENY_PATTERNS) {
    denials[pattern] = false
  }
  return denials
}

export function applyExternalMcpAllowlist(params: {
  agentResult: Record<string, unknown>
  pluginConfig: OhMyOpenCodeConfig
}): void {
  const allowlist = params.pluginConfig.external_mcp_allowlist ?? {}

  for (const [configuredAgent, patterns] of Object.entries(allowlist)) {
    const agentKey = getAgentConfigKey(configuredAgent)
    if (!EXTERNAL_MCP_ELIGIBLE_SUBAGENT_KEYS.has(agentKey)) {
      log(`warning: external MCP allowlist ignored for unsupported subagent "${configuredAgent}"`)
      continue
    }

    const agent = agentByKey(params.agentResult, agentKey, params.pluginConfig)
    if (!agent) {
      continue
    }

    const allowedPermissions: Record<string, "allow"> = {}
    for (const pattern of patterns) {
      if (!EXTERNAL_MCP_ALLOWED_PATTERNS.has(pattern)) {
        log(`warning: external MCP allowlist ignored unsupported tool pattern "${pattern}" for subagent "${configuredAgent}"`)
        continue
      }
      allowedPermissions[pattern] = "allow"
    }

    if (Object.keys(allowedPermissions).length > 0) {
      agent.permission = { ...agent.permission, ...allowedPermissions }
    }
  }
}

import type { OhMyOpenCodeConfig } from "../config"
import { getAgentDisplayName, getAgentListDisplayName } from "../shared/agent-display-names"

export type AgentWithPermission = { permission?: Record<string, unknown> }

export function agentByKey(
  agentResult: Record<string, unknown>,
  key: string,
  pluginConfig?: OhMyOpenCodeConfig,
): AgentWithPermission | undefined {
  return (agentResult[getAgentListDisplayName(key, pluginConfig?.agents)] ?? agentResult[getAgentDisplayName(key, pluginConfig?.agents)] ?? agentResult[key]) as
    | AgentWithPermission
    | undefined
}

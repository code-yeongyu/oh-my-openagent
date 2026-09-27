import { getAgentFromSession } from "../hooks/prometheus-md-only/agent-resolution"
import { log } from "../shared"
import { isConfiguredPrometheusAgent, type AgentDisplayNameOverrides } from "./prometheus-bash-visibility"
import type { PluginContext } from "./types"

export const PROMETHEUS_BASH_REFUSAL =
  "Prometheus is a planning agent and cannot run shell commands. " +
  "Use read, grep, and glob to inspect the project, or delegate investigation to explore or librarian. " +
  "Record any command the work needs as a todo in the plan."

// Always on, unlike the optional prometheus-md-only hook: on Zen free models the bash tool is in
// Prometheus's request, and OpenCode skips its permission check for commands with no command words.
export async function refusePrometheusBash(
  sessionID: string,
  ctx: Pick<PluginContext, "directory" | "client">,
  agentOverrides: AgentDisplayNameOverrides | undefined,
): Promise<void> {
  const agentName = await getAgentFromSession(sessionID, ctx.directory, ctx.client)
  if (!isConfiguredPrometheusAgent(agentName, agentOverrides)) return

  log("[prometheus-bash-guard] Refused a Prometheus bash call", { sessionID, agent: agentName })
  throw new Error(PROMETHEUS_BASH_REFUSAL)
}

import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { setPendingSwitch } from "../../features/agent-switch"
import { updateSessionAgent } from "../../features/claude-code-session-state"
import type { SwitchAgentArgs } from "./types"

const DESCRIPTION =
  "Switch the active session agent. After calling this tool, the session will transition to the specified agent " +
  "with the provided context as its starting prompt. Use this to route work to another agent " +
  "(e.g., Atlas for fixes, Prometheus for planning). The switch executes when the current agent's turn completes."

const ALLOWED_AGENTS = new Set(["atlas", "prometheus", "sisyphus", "hephaestus"])

export function createSwitchAgentTool(): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      agent: tool.schema
        .string()
        .describe("Target agent name to switch to (e.g., 'atlas', 'prometheus')"),
      context: tool.schema
        .string()
        .describe("Context message for the target agent — include confirmed findings, the original question, and what action to take"),
    },
    async execute(args: SwitchAgentArgs, toolContext) {
      const agentName = args.agent.toLowerCase()

      if (!ALLOWED_AGENTS.has(agentName)) {
        return `Invalid switch target: "${args.agent}". Allowed agents: ${[...ALLOWED_AGENTS].join(", ")}`
      }

      updateSessionAgent(toolContext.sessionID, agentName)
      setPendingSwitch(toolContext.sessionID, agentName, args.context)

      return `Agent switch queued. Session will switch to ${agentName} when your turn completes.`
    },
  })
}

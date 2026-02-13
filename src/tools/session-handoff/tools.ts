import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { setPendingHandoff } from "../../features/agent-handoff"
import { updateSessionAgent } from "../../features/claude-code-session-state"
import type { SessionHandoffArgs } from "./types"

const DESCRIPTION =
  "Switch the active session agent. After calling this tool, the session will transition to the specified agent " +
  "with the provided context as its starting prompt. Use this to hand off work to another agent " +
  "(e.g., Atlas for fixes, Prometheus for planning). The handoff executes when the current agent's turn completes."

const ALLOWED_AGENTS = new Set(["atlas", "prometheus", "sisyphus", "hephaestus"])

export function createSessionHandoffTool(): ToolDefinition {
  return tool({
    description: DESCRIPTION,
    args: {
      agent: tool.schema
        .string()
        .describe("Target agent name to hand off to (e.g., 'atlas', 'prometheus')"),
      context: tool.schema
        .string()
        .describe("Context message for the target agent — include confirmed findings, the original question, and what action to take"),
    },
    async execute(args: SessionHandoffArgs, toolContext) {
      const agentName = args.agent.toLowerCase()

      if (!ALLOWED_AGENTS.has(agentName)) {
        return `Invalid handoff target: "${args.agent}". Allowed agents: ${[...ALLOWED_AGENTS].join(", ")}`
      }

      updateSessionAgent(toolContext.sessionID, agentName)
      setPendingHandoff(toolContext.sessionID, agentName, args.context)

      return `Handoff queued. Session will switch to ${agentName} when your turn completes.`
    },
  })
}

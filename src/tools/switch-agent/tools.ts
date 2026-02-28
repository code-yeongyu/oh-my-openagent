import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { setPendingSwitch } from "../../features/agent-switch"
import { schedulePendingSwitchApply } from "../../features/agent-switch/scheduler"
import { updateSessionAgent } from "../../features/claude-code-session-state"
import type { SwitchAgentArgs } from "./types"

const DESCRIPTION =
  "Switch the active session agent. After calling this tool, the session will transition to the specified agent " +
  "with the provided context as its starting prompt. Use this to route work to another agent " +
  "(e.g., Atlas for fixes, Prometheus for planning). The switch executes when the current agent's turn completes."

const ALLOWED_AGENTS = new Set(["atlas", "prometheus", "sisyphus", "hephaestus"])

type SessionClient = {
  session: {
    prompt?: (input: {
      path: { id: string }
      body: { agent: string; parts: Array<{ type: "text"; text: string }> }
    }) => Promise<unknown>
    promptAsync: (input: {
      path: { id: string }
      body: { agent: string; parts: Array<{ type: "text"; text: string }> }
    }) => Promise<unknown>
    create?: (input?: { body?: { parentID?: string; title?: string } }) => Promise<unknown>
    messages: (input: { path: { id: string } }) => Promise<unknown>
    status?: () => Promise<unknown>
  }
}

export function createSwitchAgentTool(args: {
  client: SessionClient
}): ToolDefinition {
  const { client } = args

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
      schedulePendingSwitchApply({
        sessionID: toolContext.sessionID,
        client,
      })

      return `Agent switch queued. Session will switch to ${agentName} when your turn completes.`
    },
  })
}

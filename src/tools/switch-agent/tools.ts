import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { normalizeAgentForPrompt } from "../../shared/agent-display-names"
import { log } from "../../shared/logger"
import { SWITCHABLE_AGENT_NAMES, type SwitchAgentArgs } from "./types"

const DESCRIPTION =
  "Switch the active session agent. After calling this tool, the session will transition to the specified agent " +
  "with the provided context as its starting prompt. Use this to route work to another agent " +
  "(e.g., Atlas for fixes, Prometheus for planning). The switch executes when the current agent's turn completes.\n\n" +
  "Permanent one-way handoff. Use ONLY when you're the wrong agent for the overall job, NEVER for subtasks (use task()). " +
  "Targets: atlas, prometheus, sisyphus, hephaestus."

const ALLOWED_AGENTS = new Set<string>(SWITCHABLE_AGENT_NAMES)

type TuiClient = {
  post: (input: {
    url: string
    body: { sessionID: string }
    headers?: Record<string, string>
  }) => Promise<unknown>
}

type SessionClient = {
  session: {
    create: (input?: { body?: { parentID?: string; title?: string } }) => Promise<unknown>
    promptAsync: (input: {
      path: { id: string }
      body: { agent?: string; parts: Array<{ type: "text"; text: string }> }
    }) => Promise<unknown>
  }
}

function extractSessionId(response: unknown): string | undefined {
  if (typeof response !== "object" || response === null) {
    return undefined
  }

  const root = response as Record<string, unknown>

  if (typeof root.id === "string" && root.id.length > 0) {
    return root.id
  }

  const data = root.data
  if (typeof data === "object" && data !== null) {
    const dataRecord = data as Record<string, unknown>
    if (typeof dataRecord.id === "string" && dataRecord.id.length > 0) {
      return dataRecord.id
    }
  }

  return undefined
}

function hasTuiClient(client: SessionClient): client is SessionClient & { _client: TuiClient } {
  const maybeClient = Reflect.get(client as object, "_client")
  if (typeof maybeClient !== "object" || maybeClient === null) {
    return false
  }
  return typeof Reflect.get(maybeClient, "post") === "function"
}

async function navigateTuiToSession(client: SessionClient, sessionID: string): Promise<boolean> {
  if (!hasTuiClient(client)) {
    return false
  }
  try {
    await client._client.post({
      url: "/tui/select-session",
      body: { sessionID },
      headers: { "Content-Type": "application/json" },
    })
    return true
  } catch {
    return false
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

      const targetAgent = normalizeAgentForPrompt(agentName)
      if (!targetAgent) {
        return `Invalid switch target: "${args.agent}". Could not resolve agent name.`
      }

      const errors: string[] = []

      const response = await client.session.create().catch((error: unknown) => {
        errors.push(`session.create failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      })

      if (!response) {
        return `Failed to create handoff session. ${errors.join("; ")}`
      }

      const newSessionID = extractSessionId(response)
      if (!newSessionID) {
        return `Failed to extract session ID from create response: ${JSON.stringify(response)}`
      }

      const promptResult = await client.session.promptAsync({
        path: { id: newSessionID },
        body: {
          agent: targetAgent,
          parts: [{ type: "text", text: args.context }],
        },
      }).catch((error: unknown) => {
        errors.push(`promptAsync failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      })

      const tuiNavigated = await navigateTuiToSession(client, newSessionID)

      log("[switch-agent] Agent switch applied via fresh session", {
        sourceSessionID: toolContext.sessionID,
        newSessionID,
        agent: targetAgent,
        tuiNavigated,
        promptDelivered: promptResult !== null,
      })

      const parts = [`Agent switch to ${agentName} initiated. New session: ${newSessionID}`]
      if (!promptResult) parts.push("(warning: prompt delivery failed)")
      if (tuiNavigated) parts.push("Navigated TUI to new session.")
      if (errors.length > 0) parts.push(`Errors: ${errors.join("; ")}`)
      return parts.join(" ")
    },
  })
}

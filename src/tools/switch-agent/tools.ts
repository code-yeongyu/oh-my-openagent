import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import { normalizeAgentForPrompt } from "../../shared/agent-display-names"
import { log } from "../../shared/logger"
import type {
  HandoffSourceAgent,
  SessionMessage,
  SwitchAgentArgs,
  SwitchAgentClient,
  SwitchAgentInput,
  SwitchAgentResult,
  SwitchableAgentName,
} from "./types"
import { SWITCHABLE_AGENT_NAMES } from "./types"

const DESCRIPTION =
  "Switch the active session agent. After calling this tool, the session will transition to the specified agent " +
  "with the provided context as its starting prompt. Use this to route work to another agent " +
  "(e.g., Atlas for fixes, Prometheus for planning). The switch executes when the current agent's turn completes.\n\n" +
  "Permanent one-way handoff. Use ONLY when you're the wrong agent for the overall job, NEVER for subtasks (use task()). " +
  "Targets: atlas, prometheus, sisyphus, hephaestus."

const ALLOWED_AGENTS = new Set<string>(SWITCHABLE_AGENT_NAMES)
const PRESERVED_MESSAGE_LIMIT = 6
const PRESERVED_MESSAGE_LENGTH = 240

type PromptTarget = {
  path: { id: string }
  body: { agent?: string; parts: Array<{ type: "text"; text: string }> }
}

type TuiClient = {
  post: (input: {
    url: string
    body: { sessionID: string }
    headers?: Record<string, string>
  }) => Promise<unknown>
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

function hasTuiClient(client: SwitchAgentClient): client is SwitchAgentClient & { _client: TuiClient } {
  const maybeClient = Reflect.get(client as object, "_client")
  if (typeof maybeClient !== "object" || maybeClient === null) {
    return false
  }

  return typeof Reflect.get(maybeClient, "post") === "function"
}

function normalizeTargetAgent(agentName: string): string {
  return agentName.trim().toLowerCase()
}

export function isValidAgent(agentName: string): agentName is SwitchableAgentName {
  return ALLOWED_AGENTS.has(agentName)
}

function validateTargetAgent(agentName: string): SwitchableAgentName {
  if (!isValidAgent(agentName)) {
    throw new Error(
      `Invalid target agent: "${agentName}". Allowed agents: ${SWITCHABLE_AGENT_NAMES.join(", ")}`,
    )
  }

  return agentName
}

function extractSessionMessages(response: unknown): SessionMessage[] {
  if (Array.isArray(response)) {
    return response as SessionMessage[]
  }

  if (typeof response !== "object" || response === null) {
    return []
  }

  const record = response as { data?: unknown; "200"?: unknown }
  const payload = record.data ?? record["200"]
  return Array.isArray(payload) ? (payload as SessionMessage[]) : []
}

function normalizeMessageText(text: string): string {
  const normalized = text.replace(/\s+/g, " ").trim()
  if (normalized.length <= PRESERVED_MESSAGE_LENGTH) {
    return normalized
  }

  return `${normalized.slice(0, PRESERVED_MESSAGE_LENGTH - 3)}...`
}

function summarizeSessionMessages(messages: SessionMessage[]): string[] {
  return messages
    .map((message) => {
      const role = message.info?.role?.trim() || "unknown"
      const text = (message.parts ?? [])
        .filter((part) => part.type === "text" && typeof part.text === "string")
        .map((part) => part.text?.trim() ?? "")
        .filter((partText) => partText.length > 0)
        .join(" ")

      if (!text) {
        return null
      }

      return `- ${role}: ${normalizeMessageText(text)}`
    })
    .filter((message): message is string => message !== null)
    .slice(-PRESERVED_MESSAGE_LIMIT)
}

async function loadPreservedContext(
  client: SwitchAgentClient,
  sourceSessionID: string,
  errors: string[],
): Promise<string[]> {
  if (!client.session.messages) {
    return []
  }

  const response = await client.session.messages({
    path: { id: sourceSessionID },
  }).catch((error: unknown) => {
    errors.push(`session.messages failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  })

  if (!response) {
    return []
  }

  return summarizeSessionMessages(extractSessionMessages(response))
}

function buildHandoffPrompt(
  currentAgent: HandoffSourceAgent,
  input: SwitchAgentInput,
  preservedMessages: string[],
): string {
  const handoffMessage = input.handoffMessage?.trim() || `Continue the handoff from ${currentAgent.name}.`
  const promptSections = [
    handoffMessage,
    "",
    "Handoff metadata:",
    `- Previous agent: ${currentAgent.name}`,
    `- Source session: ${currentAgent.sessionID}`,
    `- Source message: ${currentAgent.messageID}`,
  ]

  if (preservedMessages.length > 0) {
    promptSections.push("", "Recent session context:", ...preservedMessages)
  }

  return promptSections.join("\n")
}

async function navigateTuiToSession(client: SwitchAgentClient, sessionID: string): Promise<boolean> {
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

export async function switchAgent(
  client: SwitchAgentClient,
  currentAgent: HandoffSourceAgent,
  input: SwitchAgentInput,
): Promise<SwitchAgentResult> {
  const targetAgentName = validateTargetAgent(normalizeTargetAgent(input.targetAgent))
  const targetAgent = normalizeAgentForPrompt(targetAgentName)

  if (!targetAgent) {
    throw new Error(`Invalid target agent: "${input.targetAgent}". Could not resolve agent name.`)
  }

  const errors: string[] = []
  const preservedMessages = input.preserveContext === false
    ? []
    : await loadPreservedContext(client, currentAgent.sessionID, errors)

  const response = await client.session.create({
    body: {
      parentID: currentAgent.sessionID,
      title: `Handoff: ${currentAgent.name} -> ${targetAgentName}`,
    },
  }).catch((error: unknown) => {
    errors.push(`session.create failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  })

  if (!response) {
    throw new Error(`Failed to create handoff session. ${errors.join("; ")}`)
  }

  const newSessionID = extractSessionId(response)
  if (!newSessionID) {
    throw new Error(`Failed to extract session ID from create response: ${JSON.stringify(response)}`)
  }

  const promptResult = await client.session.promptAsync({
    path: { id: newSessionID },
    body: {
      agent: targetAgent,
      parts: [{ type: "text", text: buildHandoffPrompt(currentAgent, input, preservedMessages) }],
    },
  } satisfies PromptTarget).catch((error: unknown) => {
    errors.push(`promptAsync failed: ${error instanceof Error ? error.message : String(error)}`)
    return null
  })

  const tuiNavigated = await navigateTuiToSession(client, newSessionID)

  return {
    success: true,
    previousAgent: currentAgent.name,
    currentAgent: targetAgentName,
    contextPreserved: input.preserveContext !== false,
    newSessionID,
    promptDelivered: promptResult !== null,
    tuiNavigated,
    errors,
  }
}

export function createSwitchAgentTool(args: {
  client: SwitchAgentClient
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
      try {
        const result = await switchAgent(
          client,
          {
            name: toolContext.agent,
            sessionID: toolContext.sessionID,
            messageID: toolContext.messageID,
          },
          {
            targetAgent: args.agent,
            preserveContext: true,
            handoffMessage: args.context,
          },
        )

        log("[switch-agent] Agent switch applied via explicit handoff", {
          sourceSessionID: toolContext.sessionID,
          sourceMessageID: toolContext.messageID,
          newSessionID: result.newSessionID,
          previousAgent: result.previousAgent,
          agent: result.currentAgent,
          contextPreserved: result.contextPreserved,
          tuiNavigated: result.tuiNavigated,
          promptDelivered: result.promptDelivered,
          errors: result.errors,
        })

        const parts = [
          `Agent switch to ${result.currentAgent} initiated. New session: ${result.newSessionID}`,
        ]
        if (!result.promptDelivered) parts.push("(warning: prompt delivery failed)")
        if (result.tuiNavigated) parts.push("Navigated TUI to new session.")
        if (result.errors.length > 0) parts.push(`Errors: ${result.errors.join("; ")}`)
        return parts.join(" ")
      } catch (error) {
        return error instanceof Error ? error.message : String(error)
      }
    },
  })
}

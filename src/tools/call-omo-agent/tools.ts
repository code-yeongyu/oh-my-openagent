import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { ALLOWED_AGENTS, CALL_OMO_AGENT_DESCRIPTION } from "./constants"
import type { CallOmoAgentArgs } from "./types"
import type { BackgroundManager } from "../../features/background-agent"
import { log } from "../../shared/logger"

export function createCallOmoAgent(
  ctx: PluginInput,
  backgroundManager: BackgroundManager
): ToolDefinition {
  const agentDescriptions = ALLOWED_AGENTS.map(
    (name) => `- ${name}: Specialized agent for ${name} tasks`
  ).join("\n")
  const description = CALL_OMO_AGENT_DESCRIPTION.replace("{agents}", agentDescriptions)

  return tool({
    description,
    args: {
      description: tool.schema.string().describe("A short (3-5 words) description of the task"),
      prompt: tool.schema.string().describe("The task for the agent to perform"),
      subagent_type: tool.schema
        .enum(ALLOWED_AGENTS)
        .describe("The type of specialized agent to use for this task (explore or librarian only)"),
      run_in_background: tool.schema
        .boolean()
        .describe("REQUIRED. true: run asynchronously (use background_output to get results), false: run synchronously and wait for completion"),
      session_id: tool.schema.string().describe("Existing Task session to continue").optional(),
    },
    async execute(args: CallOmoAgentArgs, toolContext) {
      log(`[call_omo_agent] Starting with agent: ${args.subagent_type}, background: ${args.run_in_background}`)

      if (!ALLOWED_AGENTS.includes(args.subagent_type as typeof ALLOWED_AGENTS[number])) {
        return `Error: Invalid agent type "${args.subagent_type}". Only ${ALLOWED_AGENTS.join(", ")} are allowed.`
      }

      if (args.run_in_background) {
        if (args.session_id) {
          return `Error: session_id is not supported in background mode. Use run_in_background=false to continue an existing session.`
        }
        return await executeBackground(args, toolContext, backgroundManager)
      }

      return await executeSync(args, toolContext, ctx)
    },
  })
}

async function executeBackground(
  args: CallOmoAgentArgs,
  toolContext: { sessionID: string; messageID: string },
  manager: BackgroundManager
): Promise<string> {
  try {
    const task = await manager.launch({
      description: args.description,
      prompt: args.prompt,
      agent: args.subagent_type,
      parentSessionID: toolContext.sessionID,
      parentMessageID: toolContext.messageID,
    })

    return `Background agent task launched successfully.

Task ID: ${task.id}
Session ID: ${task.sessionID}
Description: ${task.description}
Agent: ${task.agent} (subagent)
Status: ${task.status}

The system will notify you when the task completes.
Use \`background_output\` tool with task_id="${task.id}" to check progress:
- block=false (default): Check status immediately - returns full status info
- block=true: Wait for completion (rarely needed since system notifies)`
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return `Failed to launch background agent task: ${message}`
  }
}

async function executeSync(
  args: CallOmoAgentArgs,
  toolContext: { sessionID: string },
  ctx: PluginInput
): Promise<string> {
  let sessionID: string

  if (args.session_id) {
    log(`[call_omo_agent] Using existing session: ${args.session_id}`)
    const sessionResult = await ctx.client.session.get({
      path: { id: args.session_id },
    })
    if (sessionResult.error) {
      log(`[call_omo_agent] Session get error:`, sessionResult.error)
      return `Error: Failed to get existing session: ${sessionResult.error}`
    }
    sessionID = args.session_id
  } else {
    log(`[call_omo_agent] Creating new session with parent: ${toolContext.sessionID}`)
    const createResult = await ctx.client.session.create({
      body: {
        parentID: toolContext.sessionID,
        title: `${args.description} (@${args.subagent_type} subagent)`,
      },
    })

    if (createResult.error) {
      log(`[call_omo_agent] Session create error:`, createResult.error)
      return `Error: Failed to create session: ${createResult.error}`
    }

    sessionID = createResult.data.id
    log(`[call_omo_agent] Created session: ${sessionID}`)
  }

  log(`[call_omo_agent] Sending prompt to session ${sessionID}`)
  log(`[call_omo_agent] Prompt text:`, args.prompt.substring(0, 100))

  try {
    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        agent: args.subagent_type,
        tools: {
          task: false,
          call_omo_agent: false,
          background_task: false,
        },
        parts: [{ type: "text", text: args.prompt }],
      },
    })
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error)
    log(`[call_omo_agent] Prompt error:`, errorMessage)
    if (errorMessage.includes("agent.name") || errorMessage.includes("undefined")) {
      return `Error: Agent "${args.subagent_type}" not found. Make sure the agent is registered in your opencode.json or provided by a plugin.\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
    }
    return `Error: Failed to send prompt: ${errorMessage}\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
  }

  log(`[call_omo_agent] Prompt sent, fetching messages...`)

  const messagesResult = await ctx.client.session.messages({
    path: { id: sessionID },
  })

  if (messagesResult.error) {
    log(`[call_omo_agent] Messages error:`, messagesResult.error)
    return `Error: Failed to get messages: ${messagesResult.error}`
  }

  const messages = messagesResult.data
  log(`[call_omo_agent] Got ${messages.length} messages`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const lastAssistantMessage = messages
    .filter((m: any) => m.info.role === "assistant")
    .sort((a: any, b: any) => (b.info.time?.created || 0) - (a.info.time?.created || 0))[0]

  if (!lastAssistantMessage) {
    log(`[call_omo_agent] No assistant message found`)
    log(`[call_omo_agent] All messages:`, JSON.stringify(messages, null, 2))
    return `Error: No assistant response found\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
  }

  log(`[call_omo_agent] Found assistant message with ${lastAssistantMessage.parts.length} parts`)

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const textParts = lastAssistantMessage.parts.filter((p: any) => p.type === "text")
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const responseText = textParts.map((p: any) => p.text).join("\n")

  log(`[call_omo_agent] Got response, length: ${responseText.length}`)

  const output =
    responseText + "\n\n" + ["<task_metadata>", `session_id: ${sessionID}`, "</task_metadata>"].join("\n")

  return output
}

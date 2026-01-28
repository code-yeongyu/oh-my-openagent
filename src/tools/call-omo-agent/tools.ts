import { tool, type PluginInput, type ToolDefinition } from "@opencode-ai/plugin"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { ALLOWED_AGENTS, CALL_OMO_AGENT_DESCRIPTION } from "./constants"
import type { CallOmoAgentArgs } from "./types"
import type { BackgroundManager } from "../../features/background-agent"
import { log, getAgentToolRestrictions, includesCaseInsensitive } from "../../shared"
import { consumeNewMessages } from "../../shared/session-cursor"
import { findFirstMessageWithAgent, findNearestMessageWithFields, MESSAGE_STORAGE } from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"

function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

type ToolContextWithMetadata = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
}

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
        .string()
        .describe("The type of specialized agent to use for this task (explore or librarian only)"),
      run_in_background: tool.schema
        .boolean()
        .describe("REQUIRED. true: run asynchronously (use background_output to get results), false: run synchronously and wait for completion"),
      session_id: tool.schema.string().describe("Existing Task session to continue").optional(),
    },
    async execute(args: CallOmoAgentArgs, toolContext) {
      const toolCtx = toolContext as ToolContextWithMetadata
      log(`[call_omo_agent] Starting with agent: ${args.subagent_type}, background: ${args.run_in_background}`)

      // Case-insensitive agent validation - allows "Explore", "EXPLORE", "explore" etc.
      if (!includesCaseInsensitive([...ALLOWED_AGENTS], args.subagent_type)) {
        return `Error: Invalid agent type "${args.subagent_type}". Only ${ALLOWED_AGENTS.join(", ")} are allowed.`
      }
      
      const normalizedAgent = args.subagent_type.toLowerCase() as typeof ALLOWED_AGENTS[number]
      args = { ...args, subagent_type: normalizedAgent }

      if (args.run_in_background) {
        if (args.session_id) {
          return `Error: session_id is not supported in background mode. Use run_in_background=false to continue an existing session.`
        }
        return await executeBackground(args, toolCtx, backgroundManager)
      }

      return await executeSync(args, toolCtx, ctx)
    },
  })
}

async function executeBackground(
  args: CallOmoAgentArgs,
  toolContext: ToolContextWithMetadata,
  manager: BackgroundManager
): Promise<string> {
  try {
    const messageDir = getMessageDir(toolContext.sessionID)
    const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
    const firstMessageAgent = messageDir ? findFirstMessageWithAgent(messageDir) : null
    const sessionAgent = getSessionAgent(toolContext.sessionID)
    const parentAgent = toolContext.agent ?? sessionAgent ?? firstMessageAgent ?? prevMessage?.agent
    
    log("[call_omo_agent] parentAgent resolution", {
      sessionID: toolContext.sessionID,
      messageDir,
      ctxAgent: toolContext.agent,
      sessionAgent,
      firstMessageAgent,
      prevMessageAgent: prevMessage?.agent,
      resolvedParentAgent: parentAgent,
    })

    const task = await manager.launch({
      description: args.description,
      prompt: args.prompt,
      agent: args.subagent_type,
      parentSessionID: toolContext.sessionID,
      parentMessageID: toolContext.messageID,
      parentAgent,
    })

    toolContext.metadata?.({
      title: args.description,
      metadata: { sessionId: task.sessionID },
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
  toolContext: ToolContextWithMetadata,
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
    const parentSession = await ctx.client.session.get({
      path: { id: toolContext.sessionID },
    }).catch((err) => {
      log(`[call_omo_agent] Failed to get parent session:`, err)
      return null
    })
    log(`[call_omo_agent] Parent session dir: ${parentSession?.data?.directory}, fallback: ${ctx.directory}`)
    const parentDirectory = parentSession?.data?.directory ?? ctx.directory

    const createResult = await ctx.client.session.create({
      body: {
        parentID: toolContext.sessionID,
        title: `${args.description} (@${args.subagent_type} subagent)`,
        permission: [
          { permission: "question", action: "deny" as const, pattern: "*" },
        ],
      } as any,
      query: {
        directory: parentDirectory,
      },
    })

    if (createResult.error) {
      log(`[call_omo_agent] Session create error:`, createResult.error)
      const errorStr = String(createResult.error)
      if (errorStr.toLowerCase().includes("unauthorized")) {
        return `Error: Failed to create session (Unauthorized). This may be due to:
1. OAuth token restrictions (e.g., Claude Code credentials are restricted to Claude Code only)
2. Provider authentication issues
3. Session permission inheritance problems

Try using a different provider or API key authentication.

Original error: ${createResult.error}`
      }
      return `Error: Failed to create session: ${createResult.error}`
    }

    sessionID = createResult.data.id
    log(`[call_omo_agent] Created session: ${sessionID}`)
  }

  toolContext.metadata?.({
    title: args.description,
    metadata: { sessionId: sessionID },
  })

  log(`[call_omo_agent] Sending prompt to session ${sessionID}`)
  log(`[call_omo_agent] Prompt text:`, args.prompt.substring(0, 100))

  try {
    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        agent: args.subagent_type,
        tools: {
          ...getAgentToolRestrictions(args.subagent_type),
          task: false,
          delegate_task: false,
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

  log(`[call_omo_agent] Prompt sent, polling for completion...`)

  // Poll for session completion
  const POLL_INTERVAL_MS = 500
  const MAX_POLL_TIME_MS = 5 * 60 * 1000 // 5 minutes max
  const pollStart = Date.now()
  let lastMsgCount = 0
  let stablePolls = 0
  const STABILITY_REQUIRED = 3

  while (Date.now() - pollStart < MAX_POLL_TIME_MS) {
    // Check if aborted
    if (toolContext.abort?.aborted) {
      log(`[call_omo_agent] Aborted by user`)
      return `Task aborted.\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
    }

    await new Promise(resolve => setTimeout(resolve, POLL_INTERVAL_MS))

    // Check session status
    const statusResult = await ctx.client.session.status()
    const allStatuses = (statusResult.data ?? {}) as Record<string, { type: string }>
    const sessionStatus = allStatuses[sessionID]

    // If session is actively running, reset stability counter
    if (sessionStatus && sessionStatus.type !== "idle") {
      stablePolls = 0
      lastMsgCount = 0
      continue
    }

    // Session is idle - check message stability
    const messagesCheck = await ctx.client.session.messages({ path: { id: sessionID } })
    const msgs = ((messagesCheck as { data?: unknown }).data ?? messagesCheck) as Array<unknown>
    const currentMsgCount = msgs.length

    if (currentMsgCount > 0 && currentMsgCount === lastMsgCount) {
      stablePolls++
      if (stablePolls >= STABILITY_REQUIRED) {
        log(`[call_omo_agent] Session complete, ${currentMsgCount} messages`)
        break
      }
    } else {
      stablePolls = 0
      lastMsgCount = currentMsgCount
    }
  }

  if (Date.now() - pollStart >= MAX_POLL_TIME_MS) {
    log(`[call_omo_agent] Timeout reached`)
    return `Error: Agent task timed out after 5 minutes.\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
  }

  const messagesResult = await ctx.client.session.messages({
    path: { id: sessionID },
  })

  if (messagesResult.error) {
    log(`[call_omo_agent] Messages error:`, messagesResult.error)
    return `Error: Failed to get messages: ${messagesResult.error}`
  }

  const messages = messagesResult.data
  log(`[call_omo_agent] Got ${messages.length} messages`)

  // Include both assistant messages AND tool messages
  // Tool results (grep, glob, bash output) come from role "tool"
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const relevantMessages = messages.filter(
    (m: any) => m.info?.role === "assistant" || m.info?.role === "tool"
  )

  if (relevantMessages.length === 0) {
    log(`[call_omo_agent] No assistant or tool messages found`)
    log(`[call_omo_agent] All messages:`, JSON.stringify(messages, null, 2))
    return `Error: No assistant or tool response found\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
  }

  log(`[call_omo_agent] Found ${relevantMessages.length} relevant messages`)

  // Sort by time ascending (oldest first) to process messages in order
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const sortedMessages = [...relevantMessages].sort((a: any, b: any) => {
    const timeA = a.info?.time?.created ?? 0
    const timeB = b.info?.time?.created ?? 0
    return timeA - timeB
  })

  const newMessages = consumeNewMessages(sessionID, sortedMessages)

  if (newMessages.length === 0) {
    return `No new output since last check.\n\n<task_metadata>\nsession_id: ${sessionID}\n</task_metadata>`
  }

  // Extract content from ALL messages, not just the last one
  // Tool results may be in earlier messages while the final message is empty
  const extractedContent: string[] = []

  for (const message of newMessages) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    for (const part of (message as any).parts ?? []) {
      // Handle both "text" and "reasoning" parts (thinking models use "reasoning")
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        extractedContent.push(part.text)
      } else if (part.type === "tool_result") {
        // Tool results contain the actual output from tool calls
        const toolResult = part as { content?: string | Array<{ type: string; text?: string }> }
        if (typeof toolResult.content === "string" && toolResult.content) {
          extractedContent.push(toolResult.content)
        } else if (Array.isArray(toolResult.content)) {
          // Handle array of content blocks
          for (const block of toolResult.content) {
            if ((block.type === "text" || block.type === "reasoning") && block.text) {
              extractedContent.push(block.text)
            }
          }
        }
      }
    }
  }

  const responseText = extractedContent
    .filter((text) => text.length > 0)
    .join("\n\n")

  log(`[call_omo_agent] Got response, length: ${responseText.length}`)

  const output =
    responseText + "\n\n" + ["<task_metadata>", `session_id: ${sessionID}`, "</task_metadata>"].join("\n")

  return output
}

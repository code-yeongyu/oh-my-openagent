import { tool, type PluginInput } from "@opencode-ai/plugin"
import { ALLOWED_AGENTS, CALL_OMO_AGENT_DESCRIPTION } from "./constants"
import type { CallOmoAgentArgs } from "./types"
import type { BackgroundManager } from "../../features/background-agent"
import { log } from "../../shared/logger"
import { getToolConfigForRole } from "../../config/tool-config"
import { AGENT_ROLE_REGISTRY } from "../../agents"
import { DelegationTracker } from "../../features/orchestration"
import { setSessionAgent } from "../../features/claude-code-session-state/agent-registry"
import {
  coerceToArtifactResponse,
  truncateArtifactResponse,
  formatArtifactResponseForReturn,
  type ArtifactTruncationConfig,
} from "../../shared/artifact-response"
import type { OhMyOpenCodeConfig } from "../../config/schema"

export function createCallOmoAgent(
  ctx: PluginInput,
  backgroundManager: BackgroundManager,
  config?: OhMyOpenCodeConfig
) {
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

      const delegationTracker = DelegationTracker.getInstance()
      delegationTracker.setSessionId(toolContext.sessionID)
      
      const fromAgent = "orchestrator"
      const toAgent = args.subagent_type
      
      const delegationCheck = delegationTracker.canDelegate(fromAgent, toAgent)
      if (!delegationCheck.allowed) {
        log(`[call_omo_agent] Delegation blocked: ${delegationCheck.reason}`)
        return `Error: Delegation blocked.\n\n${delegationCheck.reason}\n\nCurrent delegation depth: ${delegationCheck.depth}`
      }

      delegationTracker.recordDelegation(fromAgent, toAgent, toolContext.sessionID)

      if (args.run_in_background) {
        if (args.session_id) {
          return `Error: session_id is not supported in background mode. Use run_in_background=false to continue an existing session.`
        }
        const result = await executeBackground(args, toolContext, backgroundManager)
        delegationTracker.popDelegation()
        return result
      }

      const result = await executeSync(args, toolContext, ctx, config, backgroundManager)
      delegationTracker.popDelegation()
      return result
    },
  })
}

const SYNC_POLL_INTERVAL_MS = 1000
const SYNC_MAX_WAIT_MS = 10 * 60 * 1000

interface ToolPart {
  type?: string
  state?: { status?: string }
}

interface Message {
  info?: { role?: string; time?: { completed?: number } }
  parts?: ToolPart[]
}

/**
 * Check if a session has running/pending tools or is actively generating.
 * Returns true if session is still working.
 */
async function hasRunningTools(ctx: PluginInput, sessionID: string): Promise<boolean> {
  try {
    const messagesResult = await ctx.client.session.messages({ path: { id: sessionID } })
    if (messagesResult.error || !messagesResult.data) return false
    
    const messages = messagesResult.data as Message[]
    if (messages.length === 0) return false
    
    // Check 1: Any tool with status "pending" or "running"
    for (const message of messages) {
      for (const part of message.parts ?? []) {
        if (part.type === "tool" && part.state?.status) {
          if (part.state.status === "pending" || part.state.status === "running") {
            log(`[call_omo_agent] Session ${sessionID} has ${part.state.status} tool`)
            return true
          }
        }
      }
    }
    
    // Check 2: If last message is USER, session is working (waiting for assistant response)
    const lastMessage = messages[messages.length - 1]
    if (lastMessage?.info?.role === "user") {
      log(`[call_omo_agent] Session ${sessionID} last message is USER - still working`)
      return true
    }
    
    // Check 3: Last assistant message still being generated (no time.completed)
    const lastAssistant = messages.filter(m => m.info?.role === "assistant").pop()
    if (lastAssistant && !lastAssistant.info?.time?.completed) {
      log(`[call_omo_agent] Session ${sessionID} assistant message not completed`)
      return true
    }
    
    return false
  } catch (error) {
    log(`[call_omo_agent] hasRunningTools error for ${sessionID}:`, error)
    return false
  }
}

/**
 * Recursively check if a session or any of its descendants have running work.
 * This handles nested child sessions (grandchildren, etc.)
 */
async function hasRunningDescendants(
  ctx: PluginInput,
  sessionID: string,
  depth = 0,
  maxDepth = 5
): Promise<boolean> {
  if (depth > maxDepth) {
    log(`[call_omo_agent] Max recursion depth reached for session ${sessionID}`)
    return false
  }
  
  // Check this session's tools first
  if (await hasRunningTools(ctx, sessionID)) {
    return true
  }
  
  // Get child sessions and check recursively
  try {
    const childrenResult = await ctx.client.session.children({ path: { id: sessionID } })
    if (childrenResult.error || !childrenResult.data) return false
    
    const children = childrenResult.data as Array<{ id: string }>
    
    for (const child of children) {
      if (await hasRunningDescendants(ctx, child.id, depth + 1, maxDepth)) {
        log(`[call_omo_agent] Descendant session ${child.id} still running (depth: ${depth + 1})`)
        return true
      }
    }
  } catch (error) {
    log(`[call_omo_agent] Error checking children for ${sessionID}:`, error)
  }
  
  return false
}

async function waitForSessionCompletion(
  sessionID: string,
  ctx: PluginInput,
  backgroundManager?: BackgroundManager
): Promise<void> {
  const startTime = Date.now()
  log(`[call_omo_agent] waitForSessionCompletion started for session: ${sessionID}`)
  
  let pollCount = 0
  
  while (Date.now() - startTime < SYNC_MAX_WAIT_MS) {
    pollCount++
    
    // Check 1: BackgroundManager tracked tasks (immediate children only)
    if (backgroundManager) {
      const childTasks = backgroundManager.getTasksByParentSession(sessionID)
      const runningChildren = childTasks.filter(t => t.status === "running")
      
      if (runningChildren.length > 0) {
        log(`[call_omo_agent] Poll #${pollCount}: ${runningChildren.length} tracked child tasks running`)
        await new Promise(resolve => setTimeout(resolve, SYNC_POLL_INTERVAL_MS))
        continue
      }
    }
    
    // Check 2: Recursively check session and ALL descendants (handles grandchildren)
    const hasRunning = await hasRunningDescendants(ctx, sessionID)
    
    if (hasRunning) {
      log(`[call_omo_agent] Poll #${pollCount}: Session or descendants still running`)
      await new Promise(resolve => setTimeout(resolve, SYNC_POLL_INTERVAL_MS))
      continue
    }
    
    log(`[call_omo_agent] Session ${sessionID} complete (no running work in tree)`)
    return
  }
  
  log(`[call_omo_agent] Session ${sessionID} timed out after ${SYNC_MAX_WAIT_MS}ms (${pollCount} polls)`)
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
  ctx: PluginInput,
  config?: OhMyOpenCodeConfig,
  backgroundManager?: BackgroundManager
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
    setSessionAgent(sessionID, args.subagent_type)
    log(`[call_omo_agent] Created session: ${sessionID}`)
  }

  log(`[call_omo_agent] Sending prompt to session ${sessionID}`)
  log(`[call_omo_agent] Prompt text:`, args.prompt.substring(0, 100))

  try {
    // LIF-62: Get role-based tool restrictions for the target agent
    const agentRole = AGENT_ROLE_REGISTRY[args.subagent_type] ?? "specialist"
    const toolConfig = getToolConfigForRole(agentRole)
    
    log(`[call_omo_agent] Applying role-based config for ${args.subagent_type} (role: ${agentRole})`)
    
    await ctx.client.session.prompt({
      path: { id: sessionID },
      body: {
        agent: args.subagent_type,
        tools: {
          // Apply role-based restrictions from tool-config.ts
          task: toolConfig.task ?? false,
          call_omo_agent: toolConfig.call_omo_agent ?? false,
          background_task: toolConfig.background_task ?? false,
          // Apply write/edit restrictions for advisor/utility roles
          write: toolConfig.write ?? true,
          edit: toolConfig.edit ?? true,
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

  log(`[call_omo_agent] Prompt sent, waiting for session completion...`)

  await waitForSessionCompletion(sessionID, ctx, backgroundManager)

  log(`[call_omo_agent] Session complete, fetching messages...`)

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

  const truncationEnabled = config?.governance?.artifact_truncation?.enabled !== false
  
  if (truncationEnabled) {
    const truncationConfig: ArtifactTruncationConfig = {
      maxSummaryTokenEstimate: config?.governance?.artifact_truncation?.max_summary_tokens ?? 200,
      maxOutputChars: config?.governance?.artifact_truncation?.max_output_chars ?? 4000,
      keepTaskMetadata: config?.governance?.artifact_truncation?.keep_task_metadata !== false,
    }
    
    const artifactResponse = coerceToArtifactResponse(responseText, {
      sessionId: sessionID,
      fromAgent: "orchestrator",
      toAgent: args.subagent_type,
    })
    
    const truncatedResponse = truncateArtifactResponse(artifactResponse, truncationConfig)
    
    log(`[call_omo_agent] Applied artifact truncation, truncated: ${truncatedResponse.telemetry.truncated}`)
    
    return formatArtifactResponseForReturn(truncatedResponse, {
      includeTaskMetadata: truncationConfig.keepTaskMetadata,
      sessionId: sessionID,
    })
  }

  const output =
    responseText + "\n\n" + ["<task_metadata>", `session_id: ${sessionID}`, "</task_metadata>"].join("\n")

  return output
}

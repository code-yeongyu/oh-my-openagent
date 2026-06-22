import type { PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { resolveMessageContext } from "../../features/hook-message-injector"
import { log } from "../../shared"
import { formatDetailedError } from "../../shared/error-formatting"
import { getSessionTools } from "../../shared/session-tools-store"
import { getMessageDir } from "./message-dir"
import type { DelegateAgentArgs } from "./types"

export async function executeBackground(
  args: DelegateAgentArgs,
  toolContext: {
    sessionID: string
    messageID: string
    agent: string
    abort: AbortSignal
    metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  },
  manager: BackgroundManager,
  client: PluginInput["client"]
): Promise<string> {
  try {
    const messageDir = getMessageDir(toolContext.sessionID)
    const { prevMessage, firstMessageAgent } = await resolveMessageContext(
      toolContext.sessionID,
      client,
      messageDir
    )

    const sessionAgent = getSessionAgent(toolContext.sessionID)
    const parentAgent = toolContext.agent ?? sessionAgent ?? firstMessageAgent ?? prevMessage?.agent
    
    log("[delegate_agent] parentAgent resolution", {
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
      parentTools: getSessionTools(toolContext.sessionID),
    })

    const WAIT_FOR_SESSION_INTERVAL_MS = 50
    const WAIT_FOR_SESSION_TIMEOUT_MS = 30000
    const waitStart = Date.now()
    let sessionId = task.sessionID
    while (!sessionId && Date.now() - waitStart < WAIT_FOR_SESSION_TIMEOUT_MS) {
      if (toolContext.abort?.aborted) {
        return `Task aborted while waiting for session to start.\n\nTask ID: ${task.id}`
      }
      const updated = manager.getTask(task.id)
      if (updated?.status === "error" || updated?.status === "cancelled" || updated?.status === "interrupt") {
        return `Task failed to start (status: ${updated.status}).\n\nTask ID: ${task.id}`
      }
      await new Promise(resolve => setTimeout(resolve, WAIT_FOR_SESSION_INTERVAL_MS))
      sessionId = manager.getTask(task.id)?.sessionID
    }

    if (!sessionId) {
      return formatDetailedError(
        new Error(`Task failed to start within timeout (30s). Task ID: ${task.id}, Status: ${task.status}`),
        {
          operation: "Launch background agent task",
          agent: task.agent,
        }
      )
    }

    await toolContext.metadata?.({
      title: args.description,
      metadata: { sessionId },
    })

    return `Background agent task launched successfully.

Task ID: ${task.id}
Session ID: ${sessionId ?? "(timed out)"}
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

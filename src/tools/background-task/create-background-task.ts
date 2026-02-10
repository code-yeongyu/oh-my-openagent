import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import type { BackgroundTaskArgs } from "./types"
import { BACKGROUND_TASK_DESCRIPTION } from "./constants"
import { findFirstMessageWithAgent, findNearestMessageWithFields } from "../../features/hook-message-injector"
import { getSessionAgent } from "../../features/claude-code-session-state"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import { log } from "../../shared/logger"
import { delay } from "./delay"
import { getMessageDir } from "./message-dir"

type ToolContextWithMetadata = {
  sessionID: string
  messageID: string
  agent: string
  abort: AbortSignal
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  callID?: string
}

export function createBackgroundTask(manager: BackgroundManager): ToolDefinition {
  return tool({
    description: BACKGROUND_TASK_DESCRIPTION,
    args: {
      description: tool.schema.string().describe("Short task description (shown in status)"),
      prompt: tool.schema.string().describe("Full detailed prompt for the agent"),
      agent: tool.schema.string().describe("Agent type to use (any registered agent)"),
    },
    async execute(args: BackgroundTaskArgs, toolContext) {
      const ctx = toolContext as ToolContextWithMetadata

      if (!args.agent || args.agent.trim() === "") {
        return `[ERROR] Agent parameter is required. Please specify which agent to use (e.g., "explore", "librarian", "build", etc.)`
      }

      try {
        const messageDir = getMessageDir(ctx.sessionID)
        const prevMessage = messageDir ? findNearestMessageWithFields(messageDir) : null
        const firstMessageAgent = messageDir ? findFirstMessageWithAgent(messageDir) : null
        const sessionAgent = getSessionAgent(ctx.sessionID)
        const parentAgent = ctx.agent ?? sessionAgent ?? firstMessageAgent ?? prevMessage?.agent

        log("[background_task] parentAgent resolution", {
          sessionID: ctx.sessionID,
          ctxAgent: ctx.agent,
          sessionAgent,
          firstMessageAgent,
          prevMessageAgent: prevMessage?.agent,
          resolvedParentAgent: parentAgent,
        })

        const parentModel =
          prevMessage?.model?.providerID && prevMessage?.model?.modelID
            ? {
                providerID: prevMessage.model.providerID,
                modelID: prevMessage.model.modelID,
                ...(prevMessage.model.variant ? { variant: prevMessage.model.variant } : {}),
              }
            : undefined

        const task = await manager.launch({
          description: args.description,
          prompt: args.prompt,
          agent: args.agent.trim(),
          parentSessionID: ctx.sessionID,
          parentMessageID: ctx.messageID,
          parentModel,
          parentAgent,
        })

        const WAIT_FOR_SESSION_INTERVAL_MS = 50
        const WAIT_FOR_SESSION_TIMEOUT_MS = 30000
        const waitStart = Date.now()
        let sessionId = task.sessionID
        while (!sessionId && Date.now() - waitStart < WAIT_FOR_SESSION_TIMEOUT_MS) {
          if (ctx.abort?.aborted) {
            await manager.cancelTask(task.id)
            return `Task aborted and cancelled while waiting for session to start.\n\nTask ID: ${task.id}`
          }
          await delay(WAIT_FOR_SESSION_INTERVAL_MS)
          const updated = manager.getTask(task.id)
          if (!updated || updated.status === "error" || updated.status === "cancelled" || updated.status === "interrupt") {
            return `Task ${!updated ? "was deleted" : `entered error state`}\.\n\nTask ID: ${task.id}`
          }
          sessionId = updated?.sessionID
        }

        const bgMeta = {
          title: args.description,
          metadata: { sessionId: sessionId ?? "pending" },
        }
        await ctx.metadata?.(bgMeta)

        if (ctx.callID) {
          storeToolMetadata(ctx.sessionID, ctx.callID, bgMeta)
        }

        return `Background task launched successfully.

Task ID: ${task.id}
Session ID: ${sessionId ?? "pending"}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}

The system will notify you when the task completes.
Use \`background_output\` tool with task_id="${task.id}" to check progress:
- block=false (default): Check status immediately - returns full status info
- block=true: Wait for completion (rarely needed since system notifies)`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `[ERROR] Failed to launch background task: ${message}`
      }
    },
  })
}

import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundTask } from "../../features/background-agent"
import { storeToolMetadata } from "../../features/tool-metadata-store"
import type { BackgroundOutputArgs } from "./types"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { BACKGROUND_OUTPUT_DESCRIPTION } from "./constants"
import { delay } from "./delay"
import { formatFullSession } from "./full-session-format"
import { formatTaskResult } from "./task-result-format"
import { formatTaskStatus } from "./task-status-format"

const SISYPHUS_JUNIOR_AGENT = "sisyphus-junior"

type ToolContextWithMetadata = {
  sessionID: string
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  callID?: string
  callId?: string
  call_id?: string
}

function resolveToolCallID(ctx: ToolContextWithMetadata): string | undefined {
  if (typeof ctx.callID === "string" && ctx.callID.trim() !== "") return ctx.callID
  if (typeof ctx.callId === "string" && ctx.callId.trim() !== "") return ctx.callId
  if (typeof ctx.call_id === "string" && ctx.call_id.trim() !== "") return ctx.call_id
  return undefined
}

function formatResolvedTitle(task: BackgroundTask): string {
  const label = task.agent === SISYPHUS_JUNIOR_AGENT && task.category ? task.category : task.agent
  return `${label} - ${task.description}`
}

export function createBackgroundOutput(manager: BackgroundOutputManager, client: BackgroundOutputClient): ToolDefinition {
  return tool({
    description: BACKGROUND_OUTPUT_DESCRIPTION,
    args: {
      task_id: tool.schema.string().describe("Task ID to get output from"),
      block: tool.schema
        .boolean()
        .optional()
        .describe(
          "Wait for completion (default: false). System notifies when done, so blocking is rarely needed."
        ),
      timeout: tool.schema.number().optional().describe("Max wait time in ms (default: 60000, max: 600000)"),
      full_session: tool.schema.boolean().optional().describe("Return full session messages with filters (default: false)"),
      include_thinking: tool.schema.boolean().optional().describe("Include thinking/reasoning parts in full_session output (default: false)"),
      message_limit: tool.schema.number().optional().describe("Max messages to return (capped at 100)"),
      since_message_id: tool.schema.string().optional().describe("Return messages after this message ID (exclusive)"),
      include_tool_results: tool.schema.boolean().optional().describe("Include tool results in full_session output (default: false)"),
      thinking_max_chars: tool.schema.number().optional().describe("Max characters for thinking content (default: 2000)"),
    },
    async execute(args: BackgroundOutputArgs, toolContext) {
      try {
        const ctx = toolContext as ToolContextWithMetadata
        const task = manager.getTask(args.task_id)
        if (!task) {
          return `Task not found: ${args.task_id}`
        }

        const meta = {
          title: formatResolvedTitle(task),
          metadata: {
            task_id: task.id,
            agent: task.agent,
            category: task.category,
            description: task.description,
            sessionId: task.sessionID ?? "pending",
          } as Record<string, unknown>,
        }
        ctx.metadata?.(meta)

        const callID = resolveToolCallID(ctx)
        if (callID) {
          storeToolMetadata(ctx.sessionID, callID, meta)
        }

        if (args.full_session === true) {
          return await formatFullSession(task, client, {
            includeThinking: args.include_thinking === true,
            messageLimit: args.message_limit,
            sinceMessageId: args.since_message_id,
            includeToolResults: args.include_tool_results === true,
            thinkingMaxChars: args.thinking_max_chars,
          })
        }

        const shouldBlock = args.block === true
        const timeoutMs = Math.min(args.timeout ?? 60000, 600000)

        if (task.status === "completed") {
          return await formatTaskResult(task, client)
        }

        if (task.status === "error" || task.status === "cancelled" || task.status === "interrupt") {
          return formatTaskStatus(task)
        }

        if (!shouldBlock) {
          return formatTaskStatus(task)
        }

        const startTime = Date.now()
        while (Date.now() - startTime < timeoutMs) {
          await delay(1000)

          const currentTask = manager.getTask(args.task_id)
          if (!currentTask) {
            return `Task was deleted: ${args.task_id}`
          }

          if (currentTask.status === "completed") {
            return await formatTaskResult(currentTask, client)
          }

           if (currentTask.status === "error" || currentTask.status === "cancelled" || currentTask.status === "interrupt") {
             return formatTaskStatus(currentTask)
           }
        }

        const finalTask = manager.getTask(args.task_id)
        if (!finalTask) {
          return `Task was deleted: ${args.task_id}`
        }
        return `Timeout exceeded (${timeoutMs}ms). Task still ${finalTask.status}.\n\n${formatTaskStatus(finalTask)}`
      } catch (error) {
        return `Error getting output: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}

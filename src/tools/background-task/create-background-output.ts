import { tool, type ToolDefinition } from "@opencode-ai/plugin"
import type { BackgroundTask } from "../../features/background-agent"
import { publishToolMetadata } from "../../features/tool-metadata-store"
import type { BackgroundOutputArgs } from "./types"
import type { BackgroundOutputClient, BackgroundOutputManager } from "./clients"
import { BACKGROUND_OUTPUT_DESCRIPTION } from "./constants"
import { delay } from "./delay"
import { formatFullSession } from "./full-session-format"
import { formatTaskResult } from "./task-result-format"
import { formatTaskStatus } from "./task-status-format"

import { getAgentDisplayName } from "../../shared/agent-display-names"
import { recordBackgroundOutputConsumption } from "../../shared/background-output-consumption"

const SISYPHUS_JUNIOR_AGENT = getAgentDisplayName("sisyphus-junior")
const MISSING_BACKGROUND_TASK_RETRY_DELAY_MS = 100

type ToolContextWithMetadata = {
  sessionID: string
  messageID?: string
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void
  callID?: string
  callId?: string
  call_id?: string
}

function formatResolvedTitle(task: BackgroundTask): string {
  const label = task.agent === SISYPHUS_JUNIOR_AGENT && task.category ? task.category : task.agent
  return `${label} - ${task.description}`
}

function isTaskActiveStatus(status: BackgroundTask["status"]): boolean {
  return status === "pending" || status === "running"
}

function appendTimeoutNote(output: string, timeoutMs: number): string {
  return `${output}\n\n> **Timed out waiting** after ${timeoutMs}ms. Task is still running; showing latest available output.`
}

function isSessionId(value: string): boolean {
  return /^ses[_-]/.test(value)
}

function isBackgroundTaskId(value: string): boolean {
  return /^bg[_-]/.test(value)
}

async function getTaskWithMissingRetry(
  manager: BackgroundOutputManager,
  taskId: string,
): Promise<BackgroundTask | undefined> {
  const task = manager.getTask(taskId)
  if (task || !isBackgroundTaskId(taskId)) {
    return task
  }

  await delay(MISSING_BACKGROUND_TASK_RETRY_DELAY_MS)
  return manager.getTask(taskId)
}

function formatTaskNotFoundMessage(taskId: string): string {
  if (!isSessionId(taskId)) {
    return `Task not found: ${taskId}`
  }

  return `Task not found: ${taskId}

background_output expects a background task ID such as \`bg_...\`, not a session ID.
Use the \`background_task_id\` / \`Background Task ID\` from the task launch output or completion notification.
To inspect this session directly, use \`session_read(session_id="${taskId}")\`, \`session_info\`, or \`session_search\`.`
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
        const task = await getTaskWithMissingRetry(manager, args.task_id)
        if (!task) {
          return formatTaskNotFoundMessage(args.task_id)
        }

        const meta = {
          title: formatResolvedTitle(task),
          metadata: {
            backgroundTaskId: task.id,
            agent: task.agent,
            category: task.category,
            description: task.description,
            ...(task.sessionId ? { sessionId: task.sessionId, taskId: task.sessionId } : {}),
          } as Record<string, unknown>,
        }
        await publishToolMetadata(ctx, meta)

        const shouldBlock = args.block === true
        const timeoutMs = Math.min(args.timeout ?? 60000, 600000)

        let resolvedTask = task

        let didTimeoutWhileActive = false

        if (shouldBlock && isTaskActiveStatus(task.status)) {
          const startTime = Date.now()
          while (Date.now() - startTime < timeoutMs) {
            await delay(1000)

            const currentTask = await getTaskWithMissingRetry(manager, args.task_id)
            if (!currentTask) {
              return `Task was deleted: ${args.task_id}`
            }

            resolvedTask = currentTask

            if (!isTaskActiveStatus(currentTask.status)) {
              break
            }
          }

          if (isTaskActiveStatus(resolvedTask.status)) {
            const finalCheck = await getTaskWithMissingRetry(manager, args.task_id)
            if (finalCheck) {
              resolvedTask = finalCheck
            }
          }

          if (isTaskActiveStatus(resolvedTask.status)) {
            didTimeoutWhileActive = true
          }
        }

        const isActive = isTaskActiveStatus(resolvedTask.status)
        const fullSession = args.full_session ?? false
        const includeThinking = isActive || (args.include_thinking ?? false)
        const includeToolResults = isActive || (args.include_tool_results ?? false)

        if (fullSession) {
          const output = await formatFullSession(resolvedTask, client, {
            includeThinking,
            messageLimit: args.message_limit,
            sinceMessageId: args.since_message_id,
            includeToolResults,
            thinkingMaxChars: args.thinking_max_chars,
          })

          return didTimeoutWhileActive ? appendTimeoutNote(output, timeoutMs) : output
        }

        if (resolvedTask.status === "completed") {
          recordBackgroundOutputConsumption(ctx.sessionID, ctx.messageID, resolvedTask.sessionId)
          return await formatTaskResult(resolvedTask, client)
        }

        if (resolvedTask.status === "error" || resolvedTask.status === "cancelled" || resolvedTask.status === "interrupt") {
          return formatTaskStatus(resolvedTask)
        }

        const statusOutput = formatTaskStatus(resolvedTask)
        return didTimeoutWhileActive ? appendTimeoutNote(statusOutput, timeoutMs) : statusOutput
      } catch (error) {
        return `Error getting output: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}

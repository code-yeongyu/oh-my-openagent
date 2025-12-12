import { tool, type PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager, BackgroundTask } from "../../features/background-agent"
import type { BackgroundTaskArgs, BackgroundOutputArgs, BackgroundCancelArgs } from "./types"
import { BACKGROUND_TASK_DESCRIPTION, BACKGROUND_OUTPUT_DESCRIPTION, BACKGROUND_CANCEL_DESCRIPTION } from "./constants"

type OpencodeClient = PluginInput["client"]

function formatDuration(start: Date, end?: Date): string {
  const duration = (end ?? new Date()).getTime() - start.getTime()
  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)
  const hours = Math.floor(minutes / 60)

  if (hours > 0) {
    return `${hours}h ${minutes % 60}m ${seconds % 60}s`
  } else if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  } else {
    return `${seconds}s`
  }
}

export function createBackgroundTask(manager: BackgroundManager) {
  return tool({
    description: BACKGROUND_TASK_DESCRIPTION,
    args: {
      description: tool.schema.string().describe("Short task description (shown in status)"),
      prompt: tool.schema.string().describe("Full detailed prompt for the agent"),
      agent: tool.schema.string().describe("Agent type to use (any agent allowed)"),
    },
    async execute(args: BackgroundTaskArgs, toolContext) {
      try {
        const task = await manager.launch({
          description: args.description,
          prompt: args.prompt,
          agent: args.agent,
          parentSessionID: toolContext.sessionID,
          parentMessageID: toolContext.messageID,
        })

        return `Background task launched successfully.

Task ID: ${task.id}
Session ID: ${task.sessionID}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}

The system will notify you when the task completes.
Use \`background_output\` tool with task_id="${task.id}" to check progress:
- block=false (default): Check status immediately - returns full status info
- block=true: Wait for completion (rarely needed since system notifies)`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `❌ Failed to launch background task: ${message}`
      }
    },
  })
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function formatTaskStatus(task: BackgroundTask): string {
  const duration = formatDuration(task.startedAt, task.completedAt)
  const progress = task.progress
    ? `\nTool calls: ${task.progress.toolCalls}\nLast tool: ${task.progress.lastTool ?? "N/A"}`
    : ""

  return `Task Status

Task ID: ${task.id}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}
Duration: ${duration}${progress}

Session ID: ${task.sessionID}`
}

async function formatTaskResult(task: BackgroundTask, client: OpencodeClient): Promise<string> {
  const messagesResult = await client.session.messages({
    path: { id: task.sessionID },
  })

  if (messagesResult.error) {
    return `Error fetching messages: ${messagesResult.error}`
  }

  // Handle both SDK response structures: direct array or wrapped in .data
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const messages = ((messagesResult as any).data ?? messagesResult) as Array<{
    info?: { role?: string }
    parts?: Array<{ type?: string; text?: string }>
  }>

  if (!Array.isArray(messages) || messages.length === 0) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt, task.completedAt)}
Session ID: ${task.sessionID}

---

(No messages found)`
  }

  const assistantMessages = messages.filter(
    (m) => m.info?.role === "assistant"
  )

  if (assistantMessages.length === 0) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt, task.completedAt)}
Session ID: ${task.sessionID}

---

(No assistant response found)`
  }

  const lastMessage = assistantMessages[assistantMessages.length - 1]
  const textParts = lastMessage?.parts?.filter(
    (p) => p.type === "text"
  ) ?? []
  const textContent = textParts
    .map((p) => p.text ?? "")
    .filter((text) => text.length > 0)
    .join("\n")

  const duration = formatDuration(task.startedAt, task.completedAt)

  return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionID}

---

${textContent || "(No text output)"}`
}

export function createBackgroundOutput(manager: BackgroundManager, client: OpencodeClient) {
  return tool({
    description: BACKGROUND_OUTPUT_DESCRIPTION,
    args: {
      task_id: tool.schema.string().describe("Task ID to get output from"),
      block: tool.schema.boolean().optional().describe("Wait for completion (default: false). System notifies when done, so blocking is rarely needed."),
      timeout: tool.schema.number().optional().describe("Max wait time in ms (default: 60000, max: 600000)"),
    },
    async execute(args: BackgroundOutputArgs) {
      try {
        const task = manager.getTask(args.task_id)
        if (!task) {
          return `Task not found: ${args.task_id}`
        }

        const shouldBlock = args.block === true
        const timeoutMs = Math.min(args.timeout ?? 60000, 600000)

        // Non-blocking: return status immediately
        if (!shouldBlock) {
          return formatTaskStatus(task)
        }

        // Already completed: return result immediately
        if (task.status === "completed") {
          return await formatTaskResult(task, client)
        }

        // Error or cancelled: return status immediately
        if (task.status === "error" || task.status === "cancelled") {
          return formatTaskStatus(task)
        }

        // Blocking: poll until completion or timeout
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

          if (currentTask.status === "error" || currentTask.status === "cancelled") {
            return formatTaskStatus(currentTask)
          }
        }

        // Timeout exceeded: return current status
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

export function createBackgroundCancel(manager: BackgroundManager, client: OpencodeClient) {
  return tool({
    description: BACKGROUND_CANCEL_DESCRIPTION,
    args: {
      taskId: tool.schema.string().describe("Task ID to cancel"),
    },
    async execute(args: BackgroundCancelArgs) {
      try {
        const task = manager.getTask(args.taskId)
        if (!task) {
          return `❌ Task not found: ${args.taskId}`
        }

        if (task.status !== "running") {
          return `❌ Cannot cancel task: current status is "${task.status}".
Only running tasks can be cancelled.`
        }

        // Fire-and-forget: abort 요청을 보내고 await 하지 않음
        // await 하면 메인 세션까지 abort 되는 문제 발생
        client.session.abort({
          path: { id: task.sessionID },
        }).catch(() => {})

        task.status = "cancelled"
        task.completedAt = new Date()

        return `✅ Task cancelled successfully

Task ID: ${task.id}
Description: ${task.description}
Session ID: ${task.sessionID}
Status: ${task.status}`
      } catch (error) {
        return `❌ Error cancelling task: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}

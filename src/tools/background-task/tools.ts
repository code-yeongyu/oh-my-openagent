import { tool, type PluginInput } from "@opencode-ai/plugin"
import type { BackgroundManager } from "../../features/background-agent"
import type { BackgroundTaskArgs, BackgroundStatusArgs, BackgroundResultArgs, BackgroundCancelArgs } from "./types"
import { BACKGROUND_TASK_DESCRIPTION, BACKGROUND_STATUS_DESCRIPTION, BACKGROUND_RESULT_DESCRIPTION, BACKGROUND_CANCEL_DESCRIPTION } from "./constants"

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
      session_id: tool.schema.string().describe("Parent session ID (auto-detected if omitted)").optional(),
    },
    async execute(args: BackgroundTaskArgs, toolContext) {
      try {
        const task = await manager.launch({
          description: args.description,
          prompt: args.prompt,
          agent: args.agent,
          parentSessionID: args.session_id ?? toolContext.sessionID,
          parentMessageID: toolContext.messageID ?? "unknown",
        })

        return `✅ Background task launched successfully!

Task ID: ${task.id}
Session ID: ${task.sessionID}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}

Use \`background_status\` tool to check progress.
Use \`background_result\` tool to retrieve results when complete.`
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        return `❌ Failed to launch background task: ${message}`
      }
    },
  })
}

export function createBackgroundStatus(manager: BackgroundManager) {
  return tool({
    description: BACKGROUND_STATUS_DESCRIPTION,
    args: {
      taskId: tool.schema.string().optional().describe("Task ID to check. If omitted, lists all tasks for current session."),
    },
    async execute(args: BackgroundStatusArgs, toolContext) {
      try {
        if (args.taskId) {
          const task = manager.getTask(args.taskId)
          if (!task) {
            return `❌ Task not found: ${args.taskId}`
          }

          const duration = formatDuration(task.startedAt, task.completedAt)
          const progress = task.progress
            ? `\nTool calls: ${task.progress.toolCalls}\nLast tool: ${task.progress.lastTool ?? "N/A"}`
            : ""

          return `📊 Task Status

Task ID: ${task.id}
Description: ${task.description}
Agent: ${task.agent}
Status: ${task.status}
Duration: ${duration}${progress}

Session ID: ${task.sessionID}`
        } else {
          const tasks = manager.getTasksByParentSession(toolContext.sessionID)

          if (tasks.length === 0) {
            return "No background tasks found for this session."
          }

          let output = `📊 Background Tasks (${tasks.length})\n\n`

          for (const task of tasks) {
            const duration = formatDuration(task.startedAt, task.completedAt)
            const progress = task.progress ? ` | ${task.progress.toolCalls} tools` : ""

            output += `• ${task.id} - ${task.status} (${duration}${progress})\n`
            output += `  ${task.description}\n\n`
          }

          return output
        }
      } catch (error) {
        return `❌ Error checking status: ${error instanceof Error ? error.message : String(error)}`
      }
    },
  })
}

export function createBackgroundResult(manager: BackgroundManager, client: OpencodeClient) {
  return tool({
    description: BACKGROUND_RESULT_DESCRIPTION,
    args: {
      taskId: tool.schema.string().describe("Task ID to retrieve result from"),
    },
    async execute(args: BackgroundResultArgs) {
      try {
        const task = manager.getTask(args.taskId)
        if (!task) {
          return `❌ Task not found: ${args.taskId}`
        }

        if (task.status !== "completed") {
          return `⏳ Task is still ${task.status}. Wait for completion.

Use \`background_status\` tool to check progress.`
        }

        const messagesResult = await client.session.messages({
          path: { id: task.sessionID },
        })

        if (messagesResult.error) {
          return `❌ Error fetching messages: ${messagesResult.error}`
        }

        const messages = messagesResult.data

        const assistantMessages = messages.filter(
          (m: any) => m.info?.role === "assistant"
        )

        if (assistantMessages.length === 0) {
          return `⚠️ Task completed but no output found.

Task ID: ${task.id}
Session ID: ${task.sessionID}`
        }

        const lastMessage = assistantMessages[assistantMessages.length - 1]

        const textParts = lastMessage.parts?.filter(
          (p: any) => p.type === "text"
        ) ?? []

        const textContent = textParts.map((p: any) => p.text).join("\n")

        const duration = formatDuration(task.startedAt, task.completedAt)

        return `✅ Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionID}

---

${textContent}`
      } catch (error) {
        return `❌ Error retrieving result: ${error instanceof Error ? error.message : String(error)}`
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

        const abortResult = await client.session.abort({
          path: { id: task.sessionID },
        })

        if (abortResult.error) {
          return `❌ Failed to abort session: ${(abortResult.error as any).message || String(abortResult.error)}`
        }

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

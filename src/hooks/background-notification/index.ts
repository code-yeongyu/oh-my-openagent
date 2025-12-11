import type { BackgroundManager, BackgroundTask } from "../../features/background-agent"

interface Event {
  type: string
  properties?: Record<string, unknown>
}

interface EventInput {
  event: Event
}

interface ChatMessageInput {
  sessionID: string
  [key: string]: unknown
}

interface ChatMessageOutput {
  parts: Array<{ type: string; text: string }>
  [key: string]: unknown
}

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

function formatNotifications(tasks: BackgroundTask[]): string {
  if (tasks.length === 0) {
    return ""
  }

  if (tasks.length > 1) {
    let message = `✅ **Background Tasks Complete (${tasks.length})**\n\n`

    for (const task of tasks) {
      const duration = formatDuration(task.startedAt, task.completedAt)
      const toolCalls = task.progress?.toolCalls ?? 0

      message += `• **${task.id}** - ${task.description}\n`
      message += `  Duration: ${duration} | Tool calls: ${toolCalls}\n\n`
    }

    message += `Use \`background_result\` tool to retrieve results.`

    return message
  }

  const task = tasks[0]
  const duration = formatDuration(task.startedAt, task.completedAt)
  const toolCalls = task.progress?.toolCalls ?? 0

  return `✅ **Background Task Complete**

**Task ID:** ${task.id}
**Description:** ${task.description}
**Duration:** ${duration}
**Tool calls:** ${toolCalls}

The background task has finished. Use \`background_result\` tool with task ID \`${task.id}\` to retrieve the full result.`
}

export function createBackgroundNotificationHook(manager: BackgroundManager) {
  const eventHandler = async ({ event }: EventInput) => {
    manager.handleEvent(event)
  }

  const chatMessageHandler = async (
    input: ChatMessageInput,
    output: ChatMessageOutput
  ) => {
    const notifications = manager.getPendingNotifications(input.sessionID)

    if (notifications.length === 0) {
      return
    }

    const message = formatNotifications(notifications)

    output.parts.unshift({
      type: "text",
      text: message,
    })

    manager.clearNotifications(input.sessionID)
  }

  return {
    event: eventHandler,
    "chat.message": chatMessageHandler,
  }
}

export type { BackgroundNotificationHookConfig } from "./types"

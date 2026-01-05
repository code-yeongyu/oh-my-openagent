import type { BackgroundManager } from "../../features/background-agent"

interface Event {
  type: string
  properties?: Record<string, unknown>
}

interface EventInput {
  event: Event
}

interface ToolExecuteInput {
  tool: string
  sessionID: string
  callID: string
}

function formatDuration(start: Date, end?: Date): string {
  const duration = (end ?? new Date()).getTime() - start.getTime()
  const seconds = Math.floor(duration / 1000)
  const minutes = Math.floor(seconds / 60)

  if (minutes > 0) {
    return `${minutes}m ${seconds % 60}s`
  }
  return `${seconds}s`
}

export function createBackgroundNotificationHook(manager: BackgroundManager) {
  const eventHandler = async ({ event }: EventInput) => {
    manager.handleEvent(event)
  }

  const preToolUseHandler = async (input: ToolExecuteInput) => {
    const pending = manager.getPendingNotifications(input.sessionID)
    
    if (pending.length === 0) {
      return
    }

    manager.clearNotifications(input.sessionID)

    const messages = pending.map(task => {
      const duration = formatDuration(task.startedAt, task.completedAt)
      return `[BACKGROUND TASK COMPLETED] Task "${task.description}" finished in ${duration}. Use background_output with task_id="${task.id}" to get results.`
    })

    return {
      messages: messages.map(text => ({
        role: "user" as const,
        parts: [{ type: "text" as const, text }],
      })),
    }
  }

  return {
    event: eventHandler,
    PreToolUse: preToolUseHandler,
  }
}

export type { BackgroundNotificationHookConfig } from "./types"

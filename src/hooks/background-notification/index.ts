import type { BackgroundManager } from "../../features/background-agent"

interface Event {
  type: string
  properties?: Record<string, unknown>
}

interface EventInput {
  event: Event
}

interface ToolExecuteInput {
  sessionID?: string
  tool: string
}

interface ToolExecuteOutput {
  title: string
  output: string
  metadata: unknown
}

export function createBackgroundNotificationHook(manager: BackgroundManager) {
  const eventHandler = async ({ event }: EventInput) => {
    manager.handleEvent(event)
  }

  const toolExecuteAfterHandler = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput
  ) => {
    const sessionID = input.sessionID
    if (!sessionID) return

    if (!manager.hasPendingNotifications(sessionID)) return

    const notifications = manager.consumePendingNotifications(sessionID)
    if (notifications.length === 0) return

    const messages = notifications.map((n) => {
      if (n.status === "error") {
        return `[BACKGROUND TASK FAILED] Task "${n.description}" failed after ${n.duration}. Error: ${n.error || "Unknown error"}. Use background_output with task_id="${n.taskId}" for details.`
      }
      return `[BACKGROUND TASK COMPLETED] Task "${n.description}" finished in ${n.duration}. Use background_output with task_id="${n.taskId}" to get results.`
    })

    const injection = "\n\n---\n" + messages.join("\n") + "\n---"

    output.output = output.output + injection
  }

  return {
    event: eventHandler,
    "tool.execute.after": toolExecuteAfterHandler,
  }
}

export type { BackgroundNotificationHookConfig } from "./types"

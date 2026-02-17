import type { BackgroundTask } from "../../features/background-agent"

type ToolExecuteInput = {
  tool: string
  sessionID: string
  callID: string
}

type ToolExecuteOutput = {
  title: string
  output: string
  metadata: unknown
}

type BackgroundNotificationStore = {
  getPendingNotifications: (sessionID: string) => BackgroundTask[]
  clearNotifications: (sessionID: string) => void
}

function formatStatus(task: BackgroundTask): string {
  if (task.status === "completed") return "COMPLETED"
  if (task.status === "interrupt") return "INTERRUPTED"
  if (task.status === "error") return "ERROR"
  return "CANCELLED"
}

function sanitizeTaskText(value: string | undefined, maxLength = 500): string {
  if (!value) return ""

  let sanitized = value.replace(/[\r\n]+/g, " ")
  sanitized = sanitized.replace(/\s+/g, " ").trim()

  if (sanitized.length > maxLength) {
    return `${sanitized.slice(0, maxLength - 3)}...`
  }

  return sanitized
}

function buildNotificationBlock(tasks: BackgroundTask[]): string {
  const lines = [
    "[BACKGROUND TASK UPDATES]",
    "",
    ...tasks.map((task) => {
      const description = sanitizeTaskText(task.description)
      const error = sanitizeTaskText(task.error)
      const errorSuffix = error ? ` | error: ${error}` : ""
      return `- ${formatStatus(task)} | ${task.id} | ${description}${errorSuffix}`
    }),
    "",
    "Use background_output(task_id=\"<id>\") to retrieve results.",
  ]

  return lines.join("\n")
}

export function createBackgroundToolOutputNotifierHook(backgroundManager: BackgroundNotificationStore) {
  const toolExecuteAfter = async (
    input: ToolExecuteInput,
    output: ToolExecuteOutput,
  ): Promise<void> => {
    const notifications = backgroundManager.getPendingNotifications(input.sessionID)
    if (notifications.length === 0) {
      return
    }

    const block = buildNotificationBlock(notifications)
    const current = output.output ?? ""
    output.output = current.trim().length > 0 ? `${block}\n\n${current}` : block

    backgroundManager.clearNotifications(input.sessionID)
  }

  return {
    "tool.execute.after": toolExecuteAfter,
  }
}

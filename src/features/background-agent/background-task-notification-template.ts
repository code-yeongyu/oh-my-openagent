import type { BackgroundTask } from "./types"

export type BackgroundTaskNotificationStatus = "COMPLETED" | "CANCELLED" | "INTERRUPTED"

export function buildBackgroundTaskNotificationText(input: {
  task: BackgroundTask
  duration: string
  statusText: BackgroundTaskNotificationStatus
  allComplete: boolean
  remainingCount: number
  completedTasks: BackgroundTask[]
}): string {
  const { task, duration, statusText, allComplete, remainingCount, completedTasks } = input

  const errorInfo = task.error ? `\n**Error:** ${task.error}` : ""

  if (allComplete) {
    const completedTasksText = completedTasks
      .map((t) => `- \`${t.id}\`: ${t.description}`)
      .join("\n")

    return `Background tasks complete.

Completed tasks:
${completedTasksText || `- \`${task.id}\`: ${task.description}`}

If you need a result now, call \`background_output(task_id="<id>")\`.
Otherwise continue the existing task normally.`
  }

  const agentInfo = task.category ? `${task.agent} (${task.category})` : task.agent

  return `Background task ${statusText.toLowerCase()}.
ID: \`${task.id}\`
Description: ${task.description}
Agent: ${agentInfo}
Duration: ${duration}${errorInfo}

${remainingCount} task${remainingCount === 1 ? "" : "s"} still in progress.
Do not poll. Continue the current task and call \`background_output(task_id="${task.id}")\` only when you need this result.`
}

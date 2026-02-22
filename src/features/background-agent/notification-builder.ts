import type { BackgroundTask } from "./types"

export function buildBackgroundTaskNotificationText(args: {
  task: BackgroundTask
  duration: string
  allComplete: boolean
  remainingCount: number
  completedTasks: BackgroundTask[]
}): string {
  const { task, duration, allComplete, remainingCount, completedTasks } = args
  const statusText =
    task.status === "completed" ? "COMPLETED" : task.status === "interrupt" ? "INTERRUPTED" : task.status === "error" ? "ERROR" : "CANCELLED"
  const errorInfo = task.error ? `\n**Error:** ${task.error}` : ""

  if (allComplete) {
    const completedTasksText = completedTasks
      .map((t) => `- \`${t.id}\`: ${t.description}`)
      .join("\n")

    return `<system-reminder>
[ALL BACKGROUND TASKS COMPLETE]

**Completed:**
${completedTasksText || `- \`${task.id}\`: ${task.description}`}

Use \`background_output(task_id="<id>")\` to retrieve each result.
</system-reminder>`
  }

  return `<system-reminder>
[BACKGROUND TASK ${statusText}]
**ID:** \`${task.id}\`
**Description:** ${task.description}
**Duration:** ${duration}${errorInfo}

**${remainingCount} task${remainingCount === 1 ? "" : "s"} still in progress.** You WILL be notified when ALL complete.
Do NOT poll - continue productive work.

Use \`background_output(task_id="${task.id}")\` to retrieve this result when ready.
</system-reminder>`
}

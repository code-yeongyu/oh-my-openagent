import type { BackgroundTaskStatus } from "./types"

export type BackgroundTaskNotificationStatus = "COMPLETED" | "CANCELLED" | "INTERRUPTED" | "ERROR"

export interface BackgroundTaskNotificationTask {
  id: string
  description: string
  status: BackgroundTaskStatus
  error?: string
}

export function buildBackgroundTaskNotificationText(input: {
  task: BackgroundTaskNotificationTask
  duration: string
  statusText: BackgroundTaskNotificationStatus
  allComplete: boolean
  remainingCount: number
  completedTasks: BackgroundTaskNotificationTask[]
}): string {
  const { task, duration, statusText, allComplete, remainingCount, completedTasks } = input

  const safeDescription = (t: BackgroundTaskNotificationTask): string => t.description || t.id
  const errorInfo = task.error ? `\n**Error:** ${task.error}` : ""

  if (allComplete) {
    const succeededTasks = completedTasks.filter((t) => t.status === "completed")
    const failedTasks = completedTasks.filter((t) => t.status !== "completed")

    const succeededText = succeededTasks.length > 0
      ? succeededTasks.map((t) => `- \`${t.id}\`: ${safeDescription(t)}`).join("\n")
      : ""
    const failedText = failedTasks.length > 0
      ? failedTasks.map((t) => `- \`${t.id}\`: ${safeDescription(t)} [${t.status.toUpperCase()}]${t.error ? ` - ${t.error}` : ""}`).join("\n")
      : ""

    const hasFailures = failedTasks.length > 0
    const header = hasFailures
      ? `[ALL BACKGROUND TASKS FINISHED - ${failedTasks.length} FAILED]`
      : "[ALL BACKGROUND TASKS COMPLETE]"

    let body = ""
    if (succeededText) {
      body += `**Completed:**\n${succeededText}\n`
    }
    if (failedText) {
      body += `\n**Failed:**\n${failedText}\n`
    }
    if (!body) {
      body = `- \`${task.id}\`: ${safeDescription(task)} [${task.status.toUpperCase()}]${task.error ? ` - ${task.error}` : ""}\n`
    }

    return `<system-reminder>
${header}

${body.trim()}

Use \`background_output(task_id="<id>")\` to retrieve each result.${hasFailures ? `\n\n**ACTION REQUIRED:** ${failedTasks.length} task(s) failed. Check errors above and decide whether to retry or proceed.` : ""}
</system-reminder>`
  }

  const isFailure = statusText !== "COMPLETED"

  return `<system-reminder>
[BACKGROUND TASK ${statusText}]
**ID:** \`${task.id}\`
**Description:** ${safeDescription(task)}
**Duration:** ${duration}${errorInfo}

**${remainingCount} task${remainingCount === 1 ? "" : "s"} still in progress.** You WILL be notified when ALL complete.
${isFailure ? "**ACTION REQUIRED:** This task failed. Check the error and decide whether to retry, cancel remaining tasks, or continue." : "Do NOT poll - continue productive work."}

Use \`background_output(task_id="${task.id}")\` to retrieve this result when ready.
</system-reminder>`
}

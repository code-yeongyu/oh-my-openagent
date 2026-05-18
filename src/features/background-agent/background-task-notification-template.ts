import type { BackgroundTaskAttempt, BackgroundTaskStatus } from "./types"

export type BackgroundTaskNotificationStatus = "COMPLETED" | "CANCELLED" | "INTERRUPTED" | "ERROR"

export interface BackgroundTaskNotificationTask {
  id: string
  description: string
  status: BackgroundTaskStatus
  error?: string
  attempts?: BackgroundTaskAttempt[]
}

function formatAttemptModel(attempt: BackgroundTaskAttempt): string {
  if (attempt.providerId && attempt.modelId) {
    return `${attempt.providerId}/${attempt.modelId}`
  }

  if (attempt.modelId) {
    return attempt.modelId
  }

  if (attempt.providerId) {
    return attempt.providerId
  }

  return "unknown-model"
}

function formatAttemptTimeline(task: BackgroundTaskNotificationTask): string {
  if (!task.attempts || task.attempts.length <= 1) {
    return ""
  }

  const lines = task.attempts
    .map((attempt) => {
      const attemptLines = [
        `  - Attempt ${attempt.attemptNumber} — ${attempt.status.toUpperCase()} — ${formatAttemptModel(attempt)} — ${attempt.sessionId ?? "unknown"}`,
      ]

      if (attempt.status !== "completed" && attempt.error) {
        attemptLines.push(`    Error: ${attempt.error}`)
      }

      return attemptLines.join("\n")
    })
    .join("\n")

  return `Background task attempts:\n${lines}`
}

function formatTaskSummaryLine(task: BackgroundTaskNotificationTask): string {
  const baseLine = `- \`${task.id}\`: ${task.description || task.id}`
  const statusSuffix = task.status === "completed"
    ? ""
    : ` [${task.status.toUpperCase()}]${task.error ? ` - ${task.error}` : ""}`
  const timeline = formatAttemptTimeline(task)

  return `${baseLine}${statusSuffix}${timeline ? `\n${timeline}` : ""}`
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
      ? succeededTasks.map((t) => formatTaskSummaryLine(t)).join("\n")
      : ""
    const failedText = failedTasks.length > 0
      ? failedTasks.map((t) => formatTaskSummaryLine(t)).join("\n")
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
      body = `${formatTaskSummaryLine(task)}\n`
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

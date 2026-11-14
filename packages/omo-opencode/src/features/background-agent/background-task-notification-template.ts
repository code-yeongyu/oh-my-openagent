import type { BackgroundTaskAttempt, BackgroundTaskStatus } from "./types"

export type BackgroundTaskNotificationStatus = "COMPLETED" | "CANCELLED" | "INTERRUPTED" | "ERROR"

export interface BackgroundTaskNotificationTask {
  id: string
  sessionId?: string
  description: string
  status: BackgroundTaskStatus
  error?: string
  attempts?: BackgroundTaskAttempt[]
}

/** The child's final answer, already cut to the notification cap. */
export interface BackgroundTaskNotificationResult {
  text: string
  truncated: boolean
}

export interface BackgroundTaskNotificationUsage {
  toolCalls?: number
}

/** Marks the notice as harness output, so the model never reads it as the user's reply or approval. */
export const TASK_NOTIFICATION_PREAMBLE =
  "[SYSTEM NOTIFICATION - NOT USER INPUT] A background task you started reports below. This is not a message from the user and approves nothing."

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
        `  - Attempt ${attempt.attemptNumber}: ${attempt.status.toUpperCase()} - ${formatAttemptModel(attempt)} - ${attempt.sessionId ?? "unknown"}`,
      ]

      if (attempt.status !== "completed" && attempt.error) {
        attemptLines.push(`    Error: ${attempt.error}`)
      }

      return attemptLines.join("\n")
    })
    .join("\n")

  return `Background task attempts:\n${lines}`
}

function formatUsage(duration: string, usage: BackgroundTaskNotificationUsage | undefined): string {
  const fields = [`duration: ${duration}`]
  if (usage?.toolCalls !== undefined) fields.push(`tool calls: ${usage.toolCalls}`)
  return fields.join(", ")
}

/**
 * One notice per finished background task, in the `<task-notification>` shape bash and monitor notices
 * share: id, status, summary, the child's final answer inline, usage. The `[...]` header lines stay as the
 * machine sentinels parent-wake dedupe and the sync poller read.
 */
export function buildBackgroundTaskNotificationText(input: {
  task: BackgroundTaskNotificationTask
  duration: string
  statusText: BackgroundTaskNotificationStatus
  allComplete: boolean
  remainingCount: number
  result?: BackgroundTaskNotificationResult
  usage?: BackgroundTaskNotificationUsage
}): string {
  const { task, duration, statusText, allComplete, remainingCount, result, usage } = input
  const status = statusText.toLowerCase()
  const description = task.description || task.id

  const headers = [`[BACKGROUND TASK ${statusText}]`]
  if (allComplete) headers.push("[ALL BACKGROUND TASKS COMPLETE]")

  const envelope = [
    "<task-notification>",
    `<task-id>${task.id}</task-id>`,
    ...(task.sessionId ? [`<session-id>${task.sessionId}</session-id>`] : []),
    `<status>${status}</status>`,
    `<summary>Task "${description}" ${status} after ${duration}</summary>`,
    ...(task.error ? [`<error>${task.error}</error>`] : []),
    ...(result ? ["<result>", result.text, "</result>"] : []),
    `<usage>${formatUsage(duration, usage)}</usage>`,
    "</task-notification>",
  ]

  const timeline = formatAttemptTimeline(task)
  const remaining = allComplete
    ? "No other background task of yours is still running."
    : `${remainingCount} other background task${remainingCount === 1 ? " is" : "s are"} still running; each one reports on its own. Do not poll.`
  const readMore = result?.truncated
    ? `The result above is cut short; read all of it with \`background_output(task_id="${task.id}")\`.`
    : `Full transcript: \`background_output(task_id="${task.id}", full_session=true)\`.`
  const continueHint = task.sessionId
    ? ` Continue this child with \`task(task_id="${task.sessionId}", prompt="...")\`.`
    : ""
  const failureHint =
    statusText === "COMPLETED"
      ? ""
      : "\n**ACTION REQUIRED:** This task did not complete. Check the error and decide whether to retry, cancel related tasks, or continue."

  return `<system-reminder>
${headers.join("\n")}
${TASK_NOTIFICATION_PREAMBLE}
${envelope.join("\n")}
${timeline ? `${timeline}\n` : ""}${remaining}
${readMore}${continueHint}${failureHint}
</system-reminder>`
}

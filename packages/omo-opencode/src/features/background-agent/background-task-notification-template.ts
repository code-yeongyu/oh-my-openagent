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

export interface BackgroundTaskNotificationInput {
  task: BackgroundTaskNotificationTask
  duration: string
  statusText: BackgroundTaskNotificationStatus
  allComplete: boolean
  remainingCount: number
  result?: BackgroundTaskNotificationResult
  usage?: BackgroundTaskNotificationUsage
  /** A fan-out member: its notice is delivered with the rest of its group, not on its own. */
  grouped?: boolean
}

function taskFieldLines(input: BackgroundTaskNotificationInput): string[] {
  const { task, duration, statusText, result, usage } = input
  const status = statusText.toLowerCase()
  return [
    `<task-id>${task.id}</task-id>`,
    ...(task.sessionId ? [`<session-id>${task.sessionId}</session-id>`] : []),
    `<status>${status}</status>`,
    `<summary>Task "${task.description || task.id}" ${status} after ${duration}</summary>`,
    ...(task.error ? [`<error>${task.error}</error>`] : []),
    ...(result ? ["<result>", result.text, "</result>"] : []),
    `<usage>${formatUsage(duration, usage)}</usage>`,
  ]
}

function remainingLine(allComplete: boolean, remainingCount: number): string {
  return allComplete
    ? "No other background task of yours is still running."
    : `${remainingCount} other background task${remainingCount === 1 ? " is" : "s are"} still running; each one reports on its own. Do not poll.`
}

const FAILURE_HINT =
  "**ACTION REQUIRED:** This task did not complete. Check the error and decide whether to retry, cancel related tasks, or continue."

/**
 * One notice per finished background task, in the `<task-notification>` shape bash and monitor notices
 * share: id, status, summary, the child's final answer inline, usage. The `[...]` header lines stay as the
 * machine sentinels parent-wake dedupe and the sync poller read.
 */
export function buildBackgroundTaskNotificationText(input: BackgroundTaskNotificationInput): string {
  const { task, statusText, allComplete, remainingCount, result, grouped } = input

  const headers = [`[BACKGROUND TASK ${statusText}]`]
  if (allComplete) headers.push("[ALL BACKGROUND TASKS COMPLETE]")

  const envelope = ["<task-notification>", ...taskFieldLines(input), "</task-notification>"]

  const timeline = formatAttemptTimeline(task)
  const remaining = grouped
    ? "Reported together with the rest of its fan-out group."
    : remainingLine(allComplete, remainingCount)
  const readMore = result?.truncated
    ? `The result above is cut short; read all of it with \`background_output(task_id="${task.id}")\`.`
    : `Full transcript: \`background_output(task_id="${task.id}", full_session=true)\`.`
  const continueHint = task.sessionId
    ? ` Continue this child with \`task(task_id="${task.sessionId}", prompt="...")\`.`
    : ""
  const failureHint = statusText === "COMPLETED" ? "" : `\n${FAILURE_HINT}`

  return `<system-reminder>
${headers.join("\n")}
${TASK_NOTIFICATION_PREAMBLE}
${envelope.join("\n")}
${timeline ? `${timeline}\n` : ""}${remaining}
${readMore}${continueHint}${failureHint}
</system-reminder>`
}

/**
 * One notice for a whole fan-out group: a single `<task-notification>` holding one `<task>` per member, in finishing
 * order, each with its own result. A failed member's `[BACKGROUND TASK <STATUS>]` line joins the headers, so the
 * wake still reads as a failure; the last member decides `[ALL BACKGROUND TASKS COMPLETE]`.
 */
export function buildTaskGroupNotificationText(
  groupId: string,
  members: readonly BackgroundTaskNotificationInput[],
): string {
  const last = members[members.length - 1]
  const failures = [
    ...new Set(members.filter((member) => member.statusText !== "COMPLETED").map((member) => member.statusText)),
  ]
  const headers = [
    "[BACKGROUND TASK GROUP COMPLETE]",
    ...failures.map((statusText) => `[BACKGROUND TASK ${statusText}]`),
    ...(last?.allComplete ? ["[ALL BACKGROUND TASKS COMPLETE]"] : []),
  ]
  const tally = Object.entries(
    members.reduce<Record<string, number>>((counts, member) => {
      const status = member.statusText.toLowerCase()
      counts[status] = (counts[status] ?? 0) + 1
      return counts
    }, {}),
  )
    .map(([status, count]) => `${count} ${status}`)
    .join(", ")
  const envelope = [
    "<task-notification>",
    `<group-id>${groupId}</group-id>`,
    `<status>${failures.length === 0 ? "completed" : "partial"}</status>`,
    `<summary>All ${members.length} tasks of fan-out group ${groupId} finished: ${tally}</summary>`,
    ...members.flatMap((member) => ["<task>", ...taskFieldLines(member), "</task>"]),
    "</task-notification>",
  ]
  const timelines = members
    .map((member) => formatAttemptTimeline(member.task))
    .filter((timeline) => timeline.length > 0)
  const truncated = members
    .filter((member) => member.result?.truncated)
    .map((member) => `\`background_output(task_id="${member.task.id}")\``)
  const readMore =
    truncated.length > 0
      ? `Some results above are cut short; read them in full with ${truncated.join(", ")}.`
      : `Full transcripts: \`background_output(task_id="<task-id>", full_session=true)\`.`

  return `<system-reminder>
${headers.join("\n")}
${TASK_NOTIFICATION_PREAMBLE}
${envelope.join("\n")}
${timelines.map((timeline) => `${timeline}\n`).join("")}${remainingLine(last?.allComplete ?? true, last?.remainingCount ?? 0)}
${readMore} Continue a child with \`task(task_id="<its session-id>", prompt="...")\`.${failures.length > 0 ? `\n${FAILURE_HINT}` : ""}
</system-reminder>`
}

import type { BackgroundTask } from "../../features/background-agent"
import { formatDuration } from "./time-format"
import { truncateText } from "./truncate-text"

export function formatTaskStatus(task: BackgroundTask): string {
  let duration: string
  if (task.status === "pending" && task.queuedAt) {
    duration = formatDuration(task.queuedAt, undefined)
  } else if (task.startedAt) {
    duration = formatDuration(task.startedAt, task.completedAt)
  } else {
    duration = "N/A"
  }

  const promptPreview = truncateText(task.prompt, 500)

  let progressSection = ""
  if (task.progress?.lastTool) {
    progressSection = `\n| Last tool | ${task.progress.lastTool} |`
  }

  let lastMessageSection = ""
  if (task.progress?.lastMessage) {
    const truncated = truncateText(task.progress.lastMessage, 500)
    const messageTime = task.progress.lastMessageAt ? task.progress.lastMessageAt.toISOString() : "N/A"
    lastMessageSection = `

## Last Message (${messageTime})

\`\`\`
${truncated}
\`\`\``
  }

   let statusNote = ""
   if (task.status === "pending") {
     statusNote = `

> **Queued**: Task is waiting for a concurrency slot to become available.`
   } else if (task.status === "running") {
     statusNote = `

> **Note**: No need to wait explicitly - the system will notify you when this task completes.`
   } else if (task.status === "error") {
     statusNote = `

> **Failed**: The task encountered an error. Check the last message for details.`
   } else if (task.status === "interrupt") {
     statusNote = `

> **Interrupted**: The task was interrupted by a prompt error. The session may contain partial results.`
   }

  const durationLabel = task.status === "pending" ? "Queued for" : "Duration"

  return `# Task Status

| Field | Value |
|-------|-------|
| Task ID | \`${task.id}\` |
| Description | ${task.description} |
| Agent | ${task.agent} |
| Status | **${task.status}** |
| ${durationLabel} | ${duration} |
| Session ID | \`${task.sessionID}\` |${progressSection}
${statusNote}
## Original Prompt

\`\`\`
${promptPreview}
\`\`\`${lastMessageSection}`
}

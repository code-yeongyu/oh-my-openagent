import { mkdir, writeFile, rename } from "node:fs/promises"
import { dirname } from "node:path"
import { log } from "../../shared"
import type { BackgroundTask } from "./types"
import type { BackgroundOutputClient } from "../../tools/background-task/clients"
import { extractMessages, getErrorMessage } from "../../tools/background-task/session-messages"
import { formatMessageTime } from "../../tools/background-task/time-format"

const OUTPUT_DIR = ".sisyphus/task-outputs"

function formatFrontmatter(task: BackgroundTask): string {
  const lines = [
    "---",
    `task_id: ${task.id}`,
    `agent: ${task.agent}`,
    `session_id: ${task.sessionID}`,
    `parent_session_id: ${task.parentSessionID}`,
    `status: ${task.status}`,
    `completed_at: ${task.completedAt?.toISOString() ?? "unknown"}`,
    "---",
  ]
  return lines.join("\n")
}

function formatTranscript(
  messages: Array<{ info?: { role?: string; time?: string | { created?: number } }; parts?: Array<{ type?: string; text?: string }> }>,
): string {
  const sorted = [...messages].sort((a, b) => {
    const timeA = String(a.info?.time ?? "")
    const timeB = String(b.info?.time ?? "")
    return timeA.localeCompare(timeB)
  })

  const lines: string[] = []
  for (const message of sorted) {
    const role = message.info?.role ?? "unknown"
    const time = formatMessageTime(message.info?.time)

    lines.push(`[${role}] ${time}`)

    for (const part of message.parts ?? []) {
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        lines.push(part.text.trim())
      }
    }

    lines.push("")
  }

  return lines.join("\n")
}

export async function writeTaskOutput(
  task: BackgroundTask,
  client: BackgroundOutputClient,
): Promise<string | null> {
  if (!task.sessionID) {
    return null
  }

  try {
    const messagesResult = await client.session.messages({
      path: { id: task.sessionID },
    })

    const errorMessage = getErrorMessage(messagesResult)
    if (errorMessage) {
      log(`[task-output-writer] Error fetching session messages for task ${task.id}: ${errorMessage}`)
      return null
    }

    const messages = extractMessages(messagesResult)
    const frontmatter = formatFrontmatter(task)
    const transcript = formatTranscript(messages)
    const content = `${frontmatter}\n\n${transcript}`

    const outputPath = `${OUTPUT_DIR}/${task.id}.md`
    const tmpPath = `${outputPath}.tmp`

    await mkdir(dirname(outputPath), { recursive: true })
    await writeFile(tmpPath, content, "utf-8")
    await rename(tmpPath, outputPath)

    return outputPath
  } catch (error) {
    log(`[task-output-writer] Failed to write output for task ${task.id}: ${error}`)
    return null
  }
}

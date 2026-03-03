import type { BackgroundTask } from "../../features/background-agent"
import { consumeNewMessages } from "../../shared/session-cursor"
import type { BackgroundOutputClient, BackgroundOutputMessagesResult } from "./clients"
import { extractMessages, getErrorMessage } from "./session-messages"
import { safeCompress, shouldCompress } from "../../shared/toon-compression"
import type { ToonCompressionConfig } from "../../config/schema/toon-compression"
import { formatDuration } from "./time-format"

function getTimeString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

const DEFAULT_COMPRESSION_CONFIG: ToonCompressionConfig = {
  enabled: false,
  threshold: 5000,
}

export interface FormatTaskResultOptions {
  compressionConfig?: ToonCompressionConfig
}

export async function formatTaskResult(
  task: BackgroundTask,
  client: BackgroundOutputClient,
  options?: FormatTaskResultOptions,
): Promise<string> {
  if (!task.sessionID) {
    return `Error: Task has no sessionID`
  }

  const compressionConfig = options?.compressionConfig ?? DEFAULT_COMPRESSION_CONFIG

  const messagesResult: BackgroundOutputMessagesResult = await client.session.messages({
    path: { id: task.sessionID },
  })

  const errorMessage = getErrorMessage(messagesResult)
  if (errorMessage) {
    return `Error fetching messages: ${errorMessage}`
  }

  const messages = extractMessages(messagesResult)
  if (!Array.isArray(messages) || messages.length === 0) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt ?? new Date(), task.completedAt)}
Session ID: ${task.sessionID}

---

(No messages found)`
  }

  const relevantMessages = messages.filter((m) => m.info?.role === "assistant" || m.info?.role === "tool")
  if (relevantMessages.length === 0) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt ?? new Date(), task.completedAt)}
Session ID: ${task.sessionID}

---

(No assistant or tool response found)`
  }

  const sortedMessages = [...relevantMessages].sort((a, b) => {
    const timeA = getTimeString(a.info?.time)
    const timeB = getTimeString(b.info?.time)
    return timeA.localeCompare(timeB)
  })

  const newMessages = consumeNewMessages(task.sessionID, sortedMessages)
  if (newMessages.length === 0) {
    const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionID}

---

(No new output since last check)`
  }

  const extractedContent: string[] = []
  for (const message of newMessages) {
    for (const part of message.parts ?? []) {
      if ((part.type === "text" || part.type === "reasoning") && part.text) {
        extractedContent.push(part.text)
        continue
      }

      if (part.type === "tool_result") {
        const toolResult = part as { content?: string | Array<{ type: string; text?: string }> }
        if (typeof toolResult.content === "string" && toolResult.content) {
          extractedContent.push(toolResult.content)
          continue
        }

        if (Array.isArray(toolResult.content)) {
          for (const block of toolResult.content) {
            if ((block.type === "text" || block.type === "reasoning") && block.text) {
              extractedContent.push(block.text)
            }
          }
        }
      }
    }
  }

  const textContent = extractedContent.filter((text) => text.length > 0).join("\n\n")
  const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)

  // Check if output should be compressed (based on final text length)
  if (compressionConfig.enabled && textContent.length > compressionConfig.threshold) {
    // Compress the structured message data for efficient LLM consumption
    const messageData = newMessages.map((m) => ({
      role: m.info?.role,
      parts: m.parts,
    }))
    if (shouldCompress(messageData, compressionConfig.threshold)) {
      const compressed = safeCompress(messageData, compressionConfig, "background-task-result")
      return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionID}

---

[Compressed output]
${compressed}`
    }
  }

  return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionID}

---

${textContent || "(No text output)"}`
}

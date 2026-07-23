import type { BackgroundTask } from "../../features/background-agent"
import { extractErrorMessage } from "../../features/background-agent/error-classifier"
import { consumeNewMessages } from "../../shared/session-cursor"
import type { BackgroundOutputClient, BackgroundOutputMessage, BackgroundOutputMessagesResult } from "./clients"
import { extractMessages, getErrorMessage } from "./session-messages"
import { formatDuration } from "./time-format"
import { truncateText } from "./truncate-text"
import { getBackgroundOutputFetchTimeoutMs, withSdkCallTimeout } from "./with-sdk-call-timeout"

const TOOL_RESULT_MAX_CHARS = 2000
const DEFAULT_FROM_END_TAIL = 20

function getTimeString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function extractAssistantText(message: BackgroundOutputMessage): string {
  const texts: string[] = []
  for (const part of message.parts ?? []) {
    if ((part.type === "text" || part.type === "reasoning") && part.text) {
      texts.push(part.text)
    }
  }
  return texts.join("\n\n")
}

function extractMessageContent(message: BackgroundOutputMessage): string {
  const chunks: string[] = []
  for (const part of message.parts ?? []) {
    if ((part.type === "text" || part.type === "reasoning") && part.text) {
      chunks.push(part.text)
      continue
    }

    if (part.type === "tool_result") {
      const content = part.content
      if (typeof content === "string" && content) {
        chunks.push(truncateText(content, TOOL_RESULT_MAX_CHARS))
        continue
      }

      if (Array.isArray(content)) {
        for (const block of content) {
          if ((block.type === "text" || block.type === "reasoning") && block.text) {
            chunks.push(truncateText(block.text, TOOL_RESULT_MAX_CHARS))
          }
        }
      }
    }
  }
  return chunks.filter((chunk) => chunk.length > 0).join("\n\n")
}

function findLastAssistantIndex(messages: BackgroundOutputMessage[]): number {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    if (messages[index]?.info?.role === "assistant" && extractAssistantText(messages[index]!).length > 0) {
      return index
    }
  }
  return -1
}

function buildResultBody(newMessages: BackgroundOutputMessage[], olderContextTail: number): string {
  const finalAnswerIndex = findLastAssistantIndex(newMessages)
  const finalAnswerText = finalAnswerIndex >= 0 ? extractAssistantText(newMessages[finalAnswerIndex]!) : ""

  const olderMessages = newMessages.filter((_, index) => index !== finalAnswerIndex).slice(-olderContextTail)
  const olderContext = olderMessages
    .map((message) => extractMessageContent(message))
    .filter((text) => text.length > 0)
    .join("\n\n")

  const sections: string[] = []
  if (finalAnswerText) {
    sections.push(`## Final answer\n\n${finalAnswerText}`)
  }
  if (olderContext) {
    sections.push(`## Older context\n\n${olderContext}`)
  }
  sections.push("> Full detail available via `full_session:true`")

  if (!finalAnswerText && !olderContext) {
    return "(No text output)"
  }
  return sections.join("\n\n")
}

export async function formatTaskResult(
  task: BackgroundTask,
  client: BackgroundOutputClient,
  options?: { fromEnd?: boolean; messageLimit?: number },
): Promise<string> {
  if (!task.sessionId) {
    return `Error: Task has no sessionID`
  }

  let messagesResult: BackgroundOutputMessagesResult
  try {
    messagesResult = await withSdkCallTimeout(
      client.session.messages({ path: { id: task.sessionId } }),
      getBackgroundOutputFetchTimeoutMs(),
    )
  } catch (error) {
    return `Error fetching messages: ${error instanceof Error ? error.message : String(error)}`
  }

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
Session ID: ${task.sessionId}

---

(No messages found)`
  }

  const relevantMessages = messages.filter((m) => m.info?.role === "assistant" || m.info?.role === "tool")
  if (relevantMessages.length === 0) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt ?? new Date(), task.completedAt)}
Session ID: ${task.sessionId}

---

(No assistant or tool response found)`
  }

  const sortedMessages = [...relevantMessages].sort((a, b) => {
    const timeA = getTimeString(a.info?.time)
    const timeB = getTimeString(b.info?.time)
    return timeA.localeCompare(timeB)
  })

  const sessionError = sortedMessages
    .filter((message) => message.info?.role === "assistant" && message.info?.error)
    .map((message) => extractErrorMessage(message.info?.error))
    .find((message): message is string => typeof message === "string" && message.length > 0)
  if (sessionError) {
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt ?? new Date(), task.completedAt)}
Session ID: ${task.sessionId}

---

Session error: ${sessionError}`
  }

  const newMessages = consumeNewMessages(task.sessionId, sortedMessages)
  if (newMessages.length === 0) {
    const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)
    return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionId}

---

(No new output since last check)`
  }

  const olderContextTail =
    typeof options?.messageLimit === "number" && options.messageLimit > 0
      ? options.messageLimit
      : DEFAULT_FROM_END_TAIL
  const body = buildResultBody(newMessages, olderContextTail)
  const duration = formatDuration(task.startedAt ?? new Date(), task.completedAt)

  return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${duration}
Session ID: ${task.sessionId}

---

${body}`
}

import type { BackgroundTask } from "../../features/background-agent"
import { extractErrorMessage } from "../../features/background-agent/error-classifier"
import { consumeNewMessages } from "../../shared/session-cursor"
import type { BackgroundOutputClient, BackgroundOutputMessage, BackgroundOutputMessagesResult } from "./clients"
import { extractMessages, getErrorMessage } from "./session-messages"
import { formatDuration } from "./time-format"
import { getBackgroundOutputFetchTimeoutMs, withSdkCallTimeout } from "./with-sdk-call-timeout"

function getTimeString(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function formatHeader(task: BackgroundTask): string {
  return `Task Result

Task ID: ${task.id}
Description: ${task.description}
Duration: ${formatDuration(task.startedAt ?? new Date(), task.completedAt)}
Session ID: ${task.sessionId}

---

`
}

type MessagePart = NonNullable<BackgroundOutputMessage["parts"]>[number]

function extractAnswerText(parts: MessagePart[] | undefined): string {
  return (parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string" && part.text.length > 0)
    .map((part) => part.text)
    .join("\n\n")
}

function extractToolResultText(part: MessagePart): string {
  const content = (part as { content?: string | Array<{ type: string; text?: string }> }).content
  if (typeof content === "string") return content
  if (!Array.isArray(content)) return ""
  return content
    .filter((block) => block.type === "text" && typeof block.text === "string" && block.text.length > 0)
    .map((block) => block.text)
    .join("\n\n")
}

function findLastToolResultText(messages: BackgroundOutputMessage[]): string {
  for (const message of messages.toReversed()) {
    for (const part of (message.parts ?? []).toReversed()) {
      if (part.type !== "tool_result") continue
      const text = extractToolResultText(part)
      if (text.length > 0) return text
    }
  }
  return ""
}

export async function formatTaskResult(task: BackgroundTask, client: BackgroundOutputClient): Promise<string> {
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
    return `${formatHeader(task)}(No messages found)`
  }

  const relevantMessages = messages.filter((m) => m.info?.role === "assistant" || m.info?.role === "tool")
  if (relevantMessages.length === 0) {
    return `${formatHeader(task)}(No assistant or tool response found)`
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
    return `${formatHeader(task)}Session error: ${sessionError}`
  }

  const newMessages = consumeNewMessages(task.sessionId, sortedMessages)
  if (newMessages.length === 0) {
    return `${formatHeader(task)}(No new output since last check)`
  }

  const assistantMessages = newMessages.filter((message) => message.info?.role === "assistant" && !message.info?.error)
  const body = extractAnswerText(assistantMessages.at(-1)?.parts) || findLastToolResultText(newMessages)

  return `${formatHeader(task)}${body || "(Task completed without text output)"}`
}

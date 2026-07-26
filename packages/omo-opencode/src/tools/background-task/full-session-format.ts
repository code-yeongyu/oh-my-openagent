import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient, BackgroundOutputMessagesResult, BackgroundOutputMessage } from "./clients"
import { extractMessages, getErrorMessage } from "./session-messages"
import { formatMessageTime } from "./time-format"
import { truncateText } from "./truncate-text"
import { formatTaskStatus } from "./task-status-format"
import { getBackgroundOutputFetchTimeoutMs, withSdkCallTimeout } from "./with-sdk-call-timeout"

const MAX_MESSAGE_LIMIT = 200
const THINKING_MAX_CHARS = 2000

export type FormattedFullSession = {
  readonly output: string
  readonly includesCompletedOutput: boolean
}

type FullSessionFormatOptions = {
  readonly includeThinking: boolean
  readonly messageLimit?: number
  readonly sinceMessageId?: string
  readonly includeToolResults: boolean
  readonly thinkingMaxChars?: number
  readonly fromEnd?: boolean
}

type NormalizedMessage = {
  readonly message: BackgroundOutputMessage
  readonly includesCompletedOutput: boolean
}

function extractToolResultText(part: NonNullable<BackgroundOutputMessage["parts"]>[number]): string[] {
  if (typeof part.content === "string" && part.content.length > 0) {
    return [part.content]
  }

  if (Array.isArray(part.content)) {
    const blocks: string[] = []
    for (const block of part.content) {
      if ((block.type === "text" || block.type === "reasoning") && block.text) {
        blocks.push(block.text)
      }
    }
    if (blocks.length > 0) return blocks
  }

  if (part.output && part.output.length > 0) {
    return [part.output]
  }

  return []
}

function formattedFullSession(output: string, includesCompletedOutput = false): FormattedFullSession {
  return { output, includesCompletedOutput }
}

function messageHasCompletedOutput(
  message: BackgroundOutputMessage,
  includeThinking: boolean,
  includeToolResults: boolean,
): boolean {
  if (message.info?.role !== "assistant" && message.info?.role !== "tool") {
    return false
  }
  return (message.parts ?? []).some((part) => {
    if (part.type === "text") return Boolean(part.text)
    if (part.type === "reasoning") return includeThinking && Boolean(part.text)
    if (part.type === "thinking") return includeThinking && Boolean(part.thinking)
    if (part.type === "tool_result") return includeToolResults && extractToolResultText(part).length > 0
    return false
  })
}

export async function formatFullSessionWithMetadata(
  task: BackgroundTask,
  client: BackgroundOutputClient,
  options: FullSessionFormatOptions,
): Promise<FormattedFullSession> {
  if (!task.sessionId) {
    return formattedFullSession(formatTaskStatus(task))
  }

  let messagesResult: BackgroundOutputMessagesResult
  try {
    messagesResult = await withSdkCallTimeout(
      client.session.messages({ path: { id: task.sessionId } }),
      getBackgroundOutputFetchTimeoutMs(),
    )
  } catch (error) {
    return formattedFullSession(`Error fetching messages: ${error instanceof Error ? error.message : String(error)}`)
  }

  const errorMessage = getErrorMessage(messagesResult)
  if (errorMessage) {
    return formattedFullSession(`Error fetching messages: ${errorMessage}`)
  }

  const rawMessages = extractMessages(messagesResult)
  if (!Array.isArray(rawMessages)) {
    return formattedFullSession("Error fetching messages: invalid response")
  }

  const sortedMessages = [...rawMessages].sort((a, b) => {
    const timeA = String(a.info?.time ?? "")
    const timeB = String(b.info?.time ?? "")
    return timeA.localeCompare(timeB)
  })

  let filteredMessages = sortedMessages
  if (options.sinceMessageId) {
    const index = filteredMessages.findIndex((message) => message.id === options.sinceMessageId)
    if (index === -1) {
      return formattedFullSession(`Error: since_message_id not found: ${options.sinceMessageId}`)
    }
    filteredMessages = filteredMessages.slice(index + 1)
  }

  const includeThinking = options.includeThinking
  const includeToolResults = options.includeToolResults
  const thinkingMaxChars = options.thinkingMaxChars ?? THINKING_MAX_CHARS

  let completedOutputMessage: BackgroundOutputMessage | undefined
  for (let index = sortedMessages.length - 1; index >= 0; index -= 1) {
    const message = sortedMessages[index]
    if (message && messageHasCompletedOutput(message, includeThinking, includeToolResults)) {
      completedOutputMessage = message
      break
    }
  }

  const normalizedMessages: NormalizedMessage[] = []
  for (const message of filteredMessages) {
    const parts = (message.parts ?? []).filter((part) => {
      if (part.type === "thinking" || part.type === "reasoning") {
        return includeThinking
      }
      if (part.type === "tool_result") {
        return includeToolResults
      }
      if (part.type === "tool_use" || part.type === "tool") {
        return includeToolResults
      }
      return part.type === "text"
    })

    if (parts.length === 0) {
      continue
    }

    normalizedMessages.push({
      message: { ...message, parts },
      includesCompletedOutput: message === completedOutputMessage,
    })
  }

  const limit = typeof options.messageLimit === "number" ? Math.min(options.messageLimit, MAX_MESSAGE_LIMIT) : undefined
  const hasMore = limit !== undefined && normalizedMessages.length > limit
  let visibleMessages: readonly NormalizedMessage[]
  if (limit === undefined) {
    visibleMessages = normalizedMessages
  } else if (options.fromEnd) {
    visibleMessages = normalizedMessages.slice(-limit)
  } else {
    visibleMessages = normalizedMessages.slice(0, limit)
  }

  const lines: string[] = []
  lines.push("# Full Session Output")
  lines.push("")
  lines.push(`Task ID: ${task.id}`)
  lines.push(`Description: ${task.description}`)
  lines.push(`Status: ${task.status}`)
  lines.push(`Session ID: ${task.sessionId}`)
  lines.push(`Total messages: ${normalizedMessages.length}`)
  lines.push(`Returned: ${visibleMessages.length}`)
  lines.push(`Has more: ${hasMore ? "true" : "false"}`)
  lines.push("")
  lines.push("## Messages")

  if (visibleMessages.length === 0) {
    lines.push("")
    lines.push("(No messages found)")
    return formattedFullSession(lines.join("\n"))
  }

  for (const { message } of visibleMessages) {
    const role = message.info?.role ?? "unknown"
    const agent = message.info?.agent ? ` (${message.info.agent})` : ""
    const time = formatMessageTime(message.info?.time)
    const idLabel = message.id ? ` id=${message.id}` : ""
    lines.push("")
    lines.push(`[${role}${agent}] ${time}${idLabel}`)

    for (const part of message.parts ?? []) {
      if (part.type === "text" && part.text) {
        lines.push(part.text.trim())
      } else if (part.type === "thinking" && part.thinking) {
        lines.push(`[thinking] ${truncateText(part.thinking, thinkingMaxChars)}`)
      } else if (part.type === "reasoning" && part.text) {
        lines.push(`[thinking] ${truncateText(part.text, thinkingMaxChars)}`)
      } else if (part.type === "tool_result") {
        const toolTexts = extractToolResultText(part)
        for (const toolText of toolTexts) {
          lines.push(`[tool result] ${toolText}`)
        }
      } else if ((part.type === "tool_use" || part.type === "tool") && part.tool) {
        const input = part.input === undefined ? "" : truncateText(JSON.stringify(part.input), thinkingMaxChars)
        lines.push(`[tool: ${part.tool}] ${input}`.trimEnd())
      }
    }
  }

  return formattedFullSession(
    lines.join("\n"),
    visibleMessages.some((entry) => entry.includesCompletedOutput),
  )
}

export async function formatFullSession(
  task: BackgroundTask,
  client: BackgroundOutputClient,
  options: FullSessionFormatOptions,
): Promise<string> {
  return (await formatFullSessionWithMetadata(task, client, options)).output
}

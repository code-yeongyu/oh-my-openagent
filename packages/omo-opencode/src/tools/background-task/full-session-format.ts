import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient, BackgroundOutputMessagesResult, BackgroundOutputMessage } from "./clients"
import { extractMessages, getErrorMessage } from "./session-messages"
import { formatMessageTime } from "./time-format"
import { truncateText } from "./truncate-text"
import { formatTaskStatus } from "./task-status-format"
import { getBackgroundOutputFetchTimeoutMs, withSdkCallTimeout } from "./with-sdk-call-timeout"

const MAX_MESSAGE_LIMIT = 200
const THINKING_MAX_CHARS = 2000
const DEFAULT_FROM_END_TAIL = 20
const TOOL_RESULT_MAX_CHARS = 2000

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

export async function formatFullSession(
  task: BackgroundTask,
  client: BackgroundOutputClient,
  options: {
    includeThinking: boolean
    messageLimit?: number
    sinceMessageId?: string
    includeToolResults: boolean
    thinkingMaxChars?: number
    fromEnd?: boolean
  }
): Promise<string> {
  if (!task.sessionId) {
    return formatTaskStatus(task)
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

  const rawMessages = extractMessages(messagesResult)
  if (!Array.isArray(rawMessages)) {
    return "Error fetching messages: invalid response"
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
      return `Error: since_message_id not found: ${options.sinceMessageId}`
    }
    filteredMessages = filteredMessages.slice(index + 1)
  }

  const includeThinking = options.includeThinking
  const includeToolResults = options.includeToolResults
  const thinkingMaxChars = options.thinkingMaxChars ?? THINKING_MAX_CHARS

  const normalizedMessages: BackgroundOutputMessage[] = []
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

    normalizedMessages.push({ ...message, parts })
  }

  const limit = typeof options.messageLimit === "number" ? Math.min(options.messageLimit, MAX_MESSAGE_LIMIT) : undefined
  const hasMore = limit !== undefined && normalizedMessages.length > limit
  let visibleMessages: typeof normalizedMessages
  if (limit === undefined) {
    visibleMessages = options.fromEnd ? normalizedMessages.slice(-DEFAULT_FROM_END_TAIL) : normalizedMessages
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
    return lines.join("\n")
  }

  for (const message of visibleMessages) {
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
          lines.push(`[tool result] ${truncateText(toolText, TOOL_RESULT_MAX_CHARS)}`)
        }
      } else if ((part.type === "tool_use" || part.type === "tool") && part.tool) {
        const input = part.input === undefined ? "" : truncateText(JSON.stringify(part.input), thinkingMaxChars)
        lines.push(`[tool: ${part.tool}] ${input}`.trimEnd())
      }
    }
  }

  return lines.join("\n")
}

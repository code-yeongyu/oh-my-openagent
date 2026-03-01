import type { BackgroundTask } from "../../features/background-agent"
import type { BackgroundOutputClient, BackgroundOutputMessagesResult, BackgroundOutputMessage } from "./clients"
import { extractMessages, getErrorMessage } from "./session-messages"
import { formatMessageTime } from "./time-format"
import { truncateText } from "./truncate-text"
import { formatTaskStatus } from "./task-status-format"
import { safeCompress, shouldCompress } from "../../shared/toon-compression"
import type { ToonCompressionConfig } from "../../config/schema/toon-compression"

const MAX_MESSAGE_LIMIT = 100
function buildSessionHeader(
  task: BackgroundTask,
  totalMessages: number,
  returnedMessages: number,
  hasMore: boolean,
): string[] {
  return [
    "# Full Session Output",
    "",
    `Task ID: ${task.id}`,
    `Description: ${task.description}`,
    `Status: ${task.status}`,
    `Session ID: ${task.sessionID}`,
    `Total messages: ${totalMessages}`,
    `Returned: ${returnedMessages}`,
    `Has more: ${hasMore ? "true" : "false"}`,
    "",
    "## Messages",
  ]
}

const THINKING_MAX_CHARS = 2000

const DEFAULT_COMPRESSION_CONFIG: ToonCompressionConfig = {
  enabled: false,
  threshold: 5000,
}

export interface FormatFullSessionOptions {
  includeThinking: boolean
  messageLimit?: number
  sinceMessageId?: string
  includeToolResults: boolean
  thinkingMaxChars?: number
  compressionConfig?: ToonCompressionConfig
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

export async function formatFullSession(
  task: BackgroundTask,
  client: BackgroundOutputClient,
  options: FormatFullSessionOptions,
): Promise<string> {
  if (!task.sessionID) {
    return formatTaskStatus(task)
  }

  const compressionConfig = options.compressionConfig ?? DEFAULT_COMPRESSION_CONFIG

  const messagesResult: BackgroundOutputMessagesResult = await client.session.messages({
    path: { id: task.sessionID },
  })

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
      return part.type === "text"
    })

    if (parts.length === 0) {
      continue
    }

    normalizedMessages.push({ ...message, parts })
  }

  const limit = typeof options.messageLimit === "number" ? Math.min(options.messageLimit, MAX_MESSAGE_LIMIT) : undefined
  const hasMore = limit !== undefined && normalizedMessages.length > limit
  const visibleMessages = limit !== undefined ? normalizedMessages.slice(0, limit) : normalizedMessages

  const lines: string[] = []
  lines.push(...buildSessionHeader(task, normalizedMessages.length, visibleMessages.length, hasMore))

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
          lines.push(`[tool result] ${toolText}`)
        }
      }
    }
  }

  const output = lines.join("\n")

  // Check if output should be compressed
  if (compressionConfig.enabled && output.length > compressionConfig.threshold) {
    // Prepare structured message data for compression
    const messageData = visibleMessages.map((m) => ({
      id: m.id,
      role: m.info?.role,
      agent: m.info?.agent,
      time: m.info?.time,
      parts: m.parts?.map((part) => {
        if (part.type === "thinking" && part.thinking) {
          return { ...part, thinking: truncateText(part.thinking, thinkingMaxChars) }
        }
        if (part.type === "reasoning" && part.text) {
          return { ...part, text: truncateText(part.text, thinkingMaxChars) }
        }
        return part
      }),
    }))

    if (shouldCompress(messageData, compressionConfig.threshold)) {
      const compressed = safeCompress(messageData, compressionConfig)
      const header = buildSessionHeader(task, normalizedMessages.length, visibleMessages.length, hasMore)
      header.push("")
      header.push("[Compressed output]")
      header.push(compressed)
      return header.join("\n")
    }
  }

  return output
}

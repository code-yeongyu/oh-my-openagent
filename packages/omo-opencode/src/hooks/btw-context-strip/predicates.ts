export type MessageRole = "user" | "assistant" | "tool"

export const BTW_AUTO_SLASH_COMMAND_MARKER = "__omoBtwAutoSlashCommand"

export type MessageWithParts = {
  info: {
    role: MessageRole
    [key: string]: unknown
  }
  parts: unknown[]
  [key: string]: unknown
}

export type BtwMarkerPredicate = (msg: MessageWithParts) => boolean

type TextPart = {
  type: "text"
  text: string
  [key: string]: unknown
}

function isTextPart(part: unknown): part is TextPart {
  if (typeof part !== "object" || part === null) {
    return false
  }

  return (
    "type" in part &&
    part.type === "text" &&
    "text" in part &&
    typeof part.text === "string"
  )
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function hasBtwCommandMetadata(msg: MessageWithParts): boolean {
  return msg.info[BTW_AUTO_SLASH_COMMAND_MARKER] === true || msg.parts.some(
    (part) => isTextPart(part) && part[BTW_AUTO_SLASH_COMMAND_MARKER] === true,
  )
}

export function hasDetectableBtwMarker(message: unknown): boolean {
  if (!isRecord(message)) {
    return false
  }

  const info = message["info"]
  if (isRecord(info)) {
    const role = info["role"]
    if (role !== undefined && role !== "user") {
      return false
    }

    if (info[BTW_AUTO_SLASH_COMMAND_MARKER] === true) {
      return true
    }
  }

  const parts = message["parts"]
  if (!Array.isArray(parts)) {
    return false
  }

  return parts.some((part) => {
    if (!isRecord(part)) {
      return false
    }

    return part[BTW_AUTO_SLASH_COMMAND_MARKER] === true
  })
}

export function isBtwMarked(msg: MessageWithParts): boolean {
  if (msg.info.role !== "user") {
    return false
  }

  return hasBtwCommandMetadata(msg)
}

export function isBtwUserMessage(
  msg: MessageWithParts,
  isMarked: BtwMarkerPredicate,
): boolean {
  return msg.info.role === "user" && isMarked(msg)
}

const TOOL_RESULT_PART_TYPES = new Set(["tool_result", "tool-result"])

function isToolResultPart(part: unknown): boolean {
  return isRecord(part) && typeof part["type"] === "string" && TOOL_RESULT_PART_TYPES.has(part["type"])
}

// Tool results ride back in user-role messages mid-turn. Such carrier messages
// belong to the /btw answer span; only a real user prompt ends the span.
export function isToolResultCarrierUserMessage(message: unknown): boolean {
  if (!isRecord(message)) {
    return false
  }

  const info = message["info"]
  if (!isRecord(info) || info["role"] !== "user") {
    return false
  }

  const parts = message["parts"]
  if (!Array.isArray(parts)) {
    return false
  }

  return parts.some(isToolResultPart) && !parts.some(isTextPart)
}

export function computeBtwStripIndices(
  messages: MessageWithParts[],
  isMarked: BtwMarkerPredicate,
): Set<number> {
  const stripIndices = new Set<number>()

  for (let index = 0; index < messages.length; index += 1) {
    const message = messages[index]
    if (message === undefined || !isBtwUserMessage(message, isMarked)) {
      continue
    }

    const answerIndices: number[] = []
    let hasLaterUserMessage = false

    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const candidate = messages[cursor]
      if (candidate === undefined) {
        continue
      }

      if (candidate.info.role === "user" && !isToolResultCarrierUserMessage(candidate)) {
        hasLaterUserMessage = true
        break
      }

      answerIndices.push(cursor)
    }

    if (!hasLaterUserMessage && answerIndices.length === 0) {
      continue
    }

    stripIndices.add(index)
    for (const answerIndex of answerIndices) {
      stripIndices.add(answerIndex)
    }
  }

  return stripIndices
}

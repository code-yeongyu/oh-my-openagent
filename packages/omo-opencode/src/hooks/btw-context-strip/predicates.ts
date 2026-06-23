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

    const assistantIndices: number[] = []
    let hasLaterUserMessage = false

    for (let cursor = index + 1; cursor < messages.length; cursor += 1) {
      const candidate = messages[cursor]
      if (candidate === undefined) {
        continue
      }

      if (candidate.info.role === "user") {
        hasLaterUserMessage = true
        break
      }

      if (candidate.info.role === "assistant") {
        assistantIndices.push(cursor)
      }
    }

    if (!hasLaterUserMessage && assistantIndices.length === 0) {
      continue
    }

    stripIndices.add(index)
    for (const assistantIndex of assistantIndices) {
      stripIndices.add(assistantIndex)
    }
  }

  return stripIndices
}

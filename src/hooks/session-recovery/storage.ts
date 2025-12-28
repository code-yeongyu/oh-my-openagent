import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE, PART_STORAGE, THINKING_TYPES, META_TYPES } from "./constants"
import type { StoredMessageMeta, StoredPart, StoredTextPart } from "./types"

export function generatePartId(): string {
  const timestamp = Date.now().toString(16)
  const random = Math.random().toString(36).substring(2, 10)
  return `prt_${timestamp}${random}`
}

export function getMessageDir(sessionID: string): string {
  if (!existsSync(MESSAGE_STORAGE)) return ""

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) {
    return directPath
  }

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) {
      return sessionPath
    }
  }

  return ""
}

export function readMessages(sessionID: string): StoredMessageMeta[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir || !existsSync(messageDir)) return []

  const messages: StoredMessageMeta[] = []
  for (const file of readdirSync(messageDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const content = readFileSync(join(messageDir, file), "utf-8")
      messages.push(JSON.parse(content))
    } catch {
      continue
    }
  }

  return messages.sort((a, b) => {
    const aTime = a.time?.created ?? 0
    const bTime = b.time?.created ?? 0
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

export function readParts(messageID: string): StoredPart[] {
  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return []

  const parts: StoredPart[] = []
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const content = readFileSync(join(partDir, file), "utf-8")
      parts.push(JSON.parse(content))
    } catch {
      continue
    }
  }

  return parts
}

export function hasContent(part: StoredPart): boolean {
  if (THINKING_TYPES.has(part.type)) return false
  if (META_TYPES.has(part.type)) return false

  if (part.type === "text") {
    const textPart = part as StoredTextPart
    return !!(textPart.text?.trim())
  }

  if (part.type === "tool" || part.type === "tool_use") {
    return true
  }

  if (part.type === "tool_result") {
    return true
  }

  return false
}

export function messageHasContent(messageID: string): boolean {
  const parts = readParts(messageID)
  return parts.some(hasContent)
}

export function injectTextPart(sessionID: string, messageID: string, text: string): boolean {
  const partDir = join(PART_STORAGE, messageID)

  if (!existsSync(partDir)) {
    mkdirSync(partDir, { recursive: true })
  }

  const partId = generatePartId()
  const part: StoredTextPart = {
    id: partId,
    sessionID,
    messageID,
    type: "text",
    text,
    synthetic: true,
  }

  try {
    writeFileSync(join(partDir, `${partId}.json`), JSON.stringify(part, null, 2))
    return true
  } catch {
    return false
  }
}

export function findEmptyMessages(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const emptyIds: string[] = []

  for (const msg of messages) {
    if (!messageHasContent(msg.id)) {
      emptyIds.push(msg.id)
    }
  }

  return emptyIds
}

export function findEmptyMessageByIndex(sessionID: string, targetIndex: number): string | null {
  const messages = readMessages(sessionID)

  // API index may differ from storage index due to system messages
  const indicesToTry = [
    targetIndex,
    targetIndex - 1,
    targetIndex + 1,
    targetIndex - 2,
    targetIndex + 2,
    targetIndex - 3,
    targetIndex - 4,
    targetIndex - 5,
  ]

  for (const idx of indicesToTry) {
    if (idx < 0 || idx >= messages.length) continue

    const targetMsg = messages[idx]

    if (!messageHasContent(targetMsg.id)) {
      return targetMsg.id
    }
  }

  return null
}

export function findFirstEmptyMessage(sessionID: string): string | null {
  const emptyIds = findEmptyMessages(sessionID)
  return emptyIds.length > 0 ? emptyIds[0] : null
}

export function findMessagesWithThinkingBlocks(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (const msg of messages) {
    if (msg.role !== "assistant") continue

    const parts = readParts(msg.id)
    const hasThinking = parts.some((p) => THINKING_TYPES.has(p.type))
    if (hasThinking) {
      result.push(msg.id)
    }
  }

  return result
}

export function findMessagesWithThinkingOnly(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (const msg of messages) {
    if (msg.role !== "assistant") continue

    const parts = readParts(msg.id)
    if (parts.length === 0) continue

    const hasThinking = parts.some((p) => THINKING_TYPES.has(p.type))
    const hasTextContent = parts.some(hasContent)

    // Has thinking but no text content = orphan thinking
    if (hasThinking && !hasTextContent) {
      result.push(msg.id)
    }
  }

  return result
}

export function findMessagesWithOrphanThinking(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue

    // NOTE: Removed isLastMessage skip - recovery needs to fix last message too
    // when "thinking must start with" errors occur on final assistant message

    const parts = readParts(msg.id)
    if (parts.length === 0) continue

    const sortedParts = [...parts].sort((a, b) => a.id.localeCompare(b.id))
    const firstPart = sortedParts[0]

    const firstIsThinking = THINKING_TYPES.has(firstPart.type)

    // NOTE: Changed condition - if first part is not thinking, it's orphan
    // regardless of whether thinking blocks exist elsewhere in the message
    if (!firstIsThinking) {
      result.push(msg.id)
    }
  }

  return result
}

/**
 * Find the most recent thinking content from previous assistant messages
 * Following Anthropic's recommendation to include thinking blocks from previous turns
 */
function findLastThinkingContent(sessionID: string, beforeMessageID: string): string {
  const messages = readMessages(sessionID)

  // Find the index of the current message
  const currentIndex = messages.findIndex(m => m.id === beforeMessageID)
  if (currentIndex === -1) return ""

  // Search backwards through previous assistant messages
  for (let i = currentIndex - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.role !== "assistant") continue

    // Look for thinking parts in this message
    const parts = readParts(msg.id)
    for (const part of parts) {
      if (THINKING_TYPES.has(part.type)) {
        // Found thinking content - return it
        // Note: 'thinking' type uses 'thinking' property, 'reasoning' type uses 'text' property
        const thinking = (part as { thinking?: string; text?: string }).thinking
        const reasoning = (part as { thinking?: string; text?: string }).text
        const content = thinking || reasoning
        if (content && content.trim().length > 0) {
          return content
        }
      }
    }
  }

  return ""
}

export function prependThinkingPart(sessionID: string, messageID: string): boolean {
  const partDir = join(PART_STORAGE, messageID)

  if (!existsSync(partDir)) {
    mkdirSync(partDir, { recursive: true })
  }

  // Try to get thinking content from previous turns (Anthropic's recommendation)
  const previousThinking = findLastThinkingContent(sessionID, messageID)

  const partId = `prt_0000000000_thinking`
  const part = {
    id: partId,
    sessionID,
    messageID,
    type: "thinking",
    thinking: previousThinking || "[Continuing from previous reasoning]",
    synthetic: true,
  }

  try {
    writeFileSync(join(partDir, `${partId}.json`), JSON.stringify(part, null, 2))
    return true
  } catch {
    return false
  }
}

export function stripThinkingParts(messageID: string): boolean {
  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return false

  let anyRemoved = false
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const filePath = join(partDir, file)
      const content = readFileSync(filePath, "utf-8")
      const part = JSON.parse(content) as StoredPart
      if (THINKING_TYPES.has(part.type)) {
        unlinkSync(filePath)
        anyRemoved = true
      }
    } catch {
      continue
    }
  }

  return anyRemoved
}

export function replaceEmptyTextParts(messageID: string, replacementText: string): boolean {
  const partDir = join(PART_STORAGE, messageID)
  if (!existsSync(partDir)) return false

  let anyReplaced = false
  for (const file of readdirSync(partDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const filePath = join(partDir, file)
      const content = readFileSync(filePath, "utf-8")
      const part = JSON.parse(content) as StoredPart

      if (part.type === "text") {
        const textPart = part as StoredTextPart
        if (!textPart.text?.trim()) {
          textPart.text = replacementText
          textPart.synthetic = true
          writeFileSync(filePath, JSON.stringify(textPart, null, 2))
          anyReplaced = true
        }
      }
    } catch {
      continue
    }
  }

  return anyReplaced
}

export function findMessagesWithEmptyTextParts(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (const msg of messages) {
    const parts = readParts(msg.id)
    const hasEmptyTextPart = parts.some((p) => {
      if (p.type !== "text") return false
      const textPart = p as StoredTextPart
      return !textPart.text?.trim()
    })

    if (hasEmptyTextPart) {
      result.push(msg.id)
    }
  }

  return result
}

export function findMessageByIndexNeedingThinking(sessionID: string, targetIndex: number): string | null {
  const messages = readMessages(sessionID)

  if (targetIndex < 0 || targetIndex >= messages.length) return null

  const targetMsg = messages[targetIndex]
  if (targetMsg.role !== "assistant") return null

  const parts = readParts(targetMsg.id)
  if (parts.length === 0) return null

  const sortedParts = [...parts].sort((a, b) => a.id.localeCompare(b.id))
  const firstPart = sortedParts[0]
  const firstIsThinking = THINKING_TYPES.has(firstPart.type)

  if (!firstIsThinking) {
    return targetMsg.id
  }

  return null
}

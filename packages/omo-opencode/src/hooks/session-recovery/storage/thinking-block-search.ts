import { THINKING_TYPES } from "../constants"
import { hasContent } from "./part-content"
import { readMessages } from "./messages-reader"
import { readParts } from "./parts-reader"

export function findMessagesWithThinkingBlocks(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (const msg of messages) {
    if (msg.role !== "assistant") continue

    const parts = readParts(msg.id)
    const hasThinking = parts.some((part) => THINKING_TYPES.has(part.type))
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

    const hasThinking = parts.some((part) => THINKING_TYPES.has(part.type))
    const hasTextContent = parts.some(hasContent)

    if (hasThinking && !hasTextContent) {
      result.push(msg.id)
    }
  }

  return result
}

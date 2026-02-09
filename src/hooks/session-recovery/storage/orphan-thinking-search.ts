import { THINKING_TYPES } from "../constants"
import { readMessages } from "./messages-reader"
import { readParts } from "./parts-reader"

export function findMessagesWithOrphanThinking(sessionID: string): string[] {
  const messages = readMessages(sessionID)
  const result: string[] = []

  for (const msg of messages) {
    if (msg.role !== "assistant") continue

    const parts = readParts(msg.id)
    if (parts.length === 0) continue

    const sortedParts = [...parts].sort((a, b) => a.id.localeCompare(b.id))
    const firstPart = sortedParts[0]
    const firstIsThinking = THINKING_TYPES.has(firstPart.type)

    if (!firstIsThinking) {
      result.push(msg.id)
    }
  }

  return result
}

export function findMessageByIndexNeedingThinking(sessionID: string, targetIndex: number): string | null {
  const messages = readMessages(sessionID)

  if (targetIndex < 0 || targetIndex >= messages.length) return null

  const targetMessage = messages[targetIndex]
  if (targetMessage.role !== "assistant") return null

  const parts = readParts(targetMessage.id)
  if (parts.length === 0) return null

  const sortedParts = [...parts].sort((a, b) => a.id.localeCompare(b.id))
  const firstPart = sortedParts[0]
  const firstIsThinking = THINKING_TYPES.has(firstPart.type)

  return firstIsThinking ? null : targetMessage.id
}

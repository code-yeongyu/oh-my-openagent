import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PART_STORAGE, THINKING_TYPES } from "../constants"
import { readMessages } from "./messages-reader"
import { readParts } from "./parts-reader"

function findLastThinkingContent(sessionID: string, beforeMessageID: string): string {
  const messages = readMessages(sessionID)

  const currentIndex = messages.findIndex((message) => message.id === beforeMessageID)
  if (currentIndex === -1) return ""

  for (let i = currentIndex - 1; i >= 0; i--) {
    const message = messages[i]
    if (message.role !== "assistant") continue

    const parts = readParts(message.id)
    for (const part of parts) {
      if (THINKING_TYPES.has(part.type)) {
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

  const previousThinking = findLastThinkingContent(sessionID, messageID)

  const partId = "prt_0000000000_thinking"
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

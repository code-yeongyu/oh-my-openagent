import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PART_STORAGE } from "../constants"
import type { StoredPart, StoredTextPart } from "../types"
import { readMessages } from "./messages-reader"
import { readParts } from "./parts-reader"

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
    const hasEmptyTextPart = parts.some((part) => {
      if (part.type !== "text") return false
      const textPart = part as StoredTextPart
      return !textPart.text?.trim()
    })

    if (hasEmptyTextPart) {
      result.push(msg.id)
    }
  }

  return result
}

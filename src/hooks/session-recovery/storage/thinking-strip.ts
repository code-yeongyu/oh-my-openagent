import { existsSync, readdirSync, readFileSync, unlinkSync } from "node:fs"
import { join } from "node:path"
import { PART_STORAGE, THINKING_TYPES } from "../constants"
import type { StoredPart } from "../types"

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

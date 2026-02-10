import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { PART_STORAGE } from "../constants"
import type { StoredPart } from "../types"

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

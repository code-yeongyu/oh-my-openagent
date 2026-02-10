import { existsSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { PART_STORAGE } from "../constants"
import type { StoredTextPart } from "../types"
import { generatePartId } from "./part-id"

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

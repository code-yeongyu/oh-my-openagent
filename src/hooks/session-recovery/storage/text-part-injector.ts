import { writeFileSync } from "node:fs"
import { join } from "node:path"
import { PART_STORAGE } from "../constants"
import type { StoredTextPart } from "../types"
import { generatePartId } from "./part-id"
import { ensureDirectory } from "../../../shared/ensure-directory"

export function injectTextPart(sessionID: string, messageID: string, text: string): boolean {
  const partDir = join(PART_STORAGE, messageID)

  ensureDirectory(partDir)

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

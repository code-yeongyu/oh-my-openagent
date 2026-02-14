import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeStorageDir } from "./data-path"

const MESSAGE_STORAGE = join(getOpenCodeStorageDir(), "message")

export function getMessageDir(sessionID: string): string | null {
  if (!sessionID.startsWith("ses_")) return null
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) {
    return directPath
  }

  try {
    for (const dir of readdirSync(MESSAGE_STORAGE)) {
      const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
      if (existsSync(sessionPath)) {
        return sessionPath
      }
    }
  } catch {
    return null
  }

  return null
}
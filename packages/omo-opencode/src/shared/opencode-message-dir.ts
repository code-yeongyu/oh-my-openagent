import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE } from "./opencode-storage-paths"
import { log } from "./logger"

export function getMessageDir(sessionID: string, messageStorage = MESSAGE_STORAGE): string | null {
  if (!sessionID.startsWith("ses_")) return null
  if (/[/\\]|\.\./.test(sessionID)) return null
  if (!existsSync(messageStorage)) return null

  const directPath = join(messageStorage, sessionID)
  if (existsSync(directPath)) {
    return directPath
  }

  try {
    for (const dir of readdirSync(messageStorage)) {
      const sessionPath = join(messageStorage, dir, sessionID)
      if (existsSync(sessionPath)) {
        return sessionPath
      }
    }
  } catch (error) {
    log("[opencode-message-dir] Failed to scan message directories", { sessionID, error: String(error) })
    return null
  }

  return null
}

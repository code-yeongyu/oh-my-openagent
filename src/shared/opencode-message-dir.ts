import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { MESSAGE_STORAGE } from "./opencode-storage-paths"
import { isSqliteBackend } from "./opencode-storage-detection"
import { log } from "./logger"

export function getMessageDir(sessionID: string): string | null {
  if (!sessionID.startsWith("ses_")) return null
  if (/[/\\]|\.\./.test(sessionID)) return null
  if (isSqliteBackend()) return null
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
  } catch (error) {
    log("[opencode-message-dir] Failed to scan message directories", { sessionID, error: String(error) })
    return null
  }

  return null
}
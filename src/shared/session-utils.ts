import * as path from "node:path"
import * as os from "node:os"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"

function getMessageStoragePath(): string {
  const xdgDataHome = process.env.XDG_DATA_HOME ?? path.join(os.homedir(), ".local", "share")
  const openCodeStorage = path.join(xdgDataHome, "opencode", "storage")
  return path.join(openCodeStorage, "message")
}

export function getMessageDir(sessionID: string): string | null {
  const messageStorage = getMessageStoragePath()
  if (!existsSync(messageStorage)) return null

  const directPath = join(messageStorage, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(messageStorage)) {
    const sessionPath = join(messageStorage, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

export function isCallerOrchestrator(sessionID?: string): boolean {
  if (!sessionID) return false
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return false
  const { findNearestMessageWithFields } = require("../../features/hook-message-injector")
  const nearest = findNearestMessageWithFields(messageDir)
  return nearest?.agent?.toLowerCase() === "atlas"
}

import * as path from "node:path"
import * as os from "node:os"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { findNearestMessageWithFields, MESSAGE_STORAGE } from "../features/hook-message-injector"

export function getMessageDir(sessionID: string): string | null {
  if (!existsSync(MESSAGE_STORAGE)) return null

  const directPath = join(MESSAGE_STORAGE, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(MESSAGE_STORAGE)) {
    const sessionPath = join(MESSAGE_STORAGE, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

export function isCallerOrchestrator(sessionID?: string): boolean {
  if (!sessionID) return false
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return false
  const nearest = findNearestMessageWithFields(messageDir)
  return nearest?.agent?.toLowerCase() === "atlas"
}

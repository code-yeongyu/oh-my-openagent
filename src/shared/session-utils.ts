import * as path from "node:path"
import * as os from "node:os"
import { existsSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { findNearestMessageWithFields, MESSAGE_STORAGE } from "../features/hook-message-injector"
import { getMessageDir } from "./opencode-message-dir"

export function isCallerOrchestrator(sessionID?: string): boolean {
  if (!sessionID) return false
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return false
  const nearest = findNearestMessageWithFields(messageDir)
  return nearest?.agent?.toLowerCase() === "atlas"
}

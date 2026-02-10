import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import type { StoredMessageMeta } from "../types"
import { getMessageDir } from "./message-dir"

export function readMessages(sessionID: string): StoredMessageMeta[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir || !existsSync(messageDir)) return []

  const messages: StoredMessageMeta[] = []
  for (const file of readdirSync(messageDir)) {
    if (!file.endsWith(".json")) continue
    try {
      const content = readFileSync(join(messageDir, file), "utf-8")
      messages.push(JSON.parse(content))
    } catch {
      continue
    }
  }

  return messages.sort((a, b) => {
    const aTime = a.time?.created ?? 0
    const bTime = b.time?.created ?? 0
    if (aTime !== bTime) return aTime - bTime
    return a.id.localeCompare(b.id)
  })
}

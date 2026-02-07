import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { getOpenCodeStorageDir } from "../../shared/data-path"
import { truncateToolResult } from "./storage"
import { log } from "../../shared/logger"

interface StoredToolPart {
  type?: string
  callID?: string
  truncated?: boolean
  state?: {
    output?: string
  }
}

function getMessageStorage(): string {
  return join(getOpenCodeStorageDir(), "message")
}

function getPartStorage(): string {
  return join(getOpenCodeStorageDir(), "part")
}

function getMessageDir(sessionID: string): string | null {
  const messageStorage = getMessageStorage()
  if (!existsSync(messageStorage)) return null

  const directPath = join(messageStorage, sessionID)
  if (existsSync(directPath)) return directPath

  for (const dir of readdirSync(messageStorage)) {
    const sessionPath = join(messageStorage, dir, sessionID)
    if (existsSync(sessionPath)) return sessionPath
  }

  return null
}

function getMessageIds(sessionID: string): string[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir) return []

  const messageIds: string[] = []
  for (const file of readdirSync(messageDir)) {
    if (!file.endsWith(".json")) continue
    messageIds.push(file.replace(".json", ""))
  }

  return messageIds
}

export function truncateToolOutputsByCallId(
  sessionID: string,
  callIds: Set<string>,
): { truncatedCount: number } {
  if (callIds.size === 0) return { truncatedCount: 0 }

  const messageIds = getMessageIds(sessionID)
  if (messageIds.length === 0) return { truncatedCount: 0 }

  let truncatedCount = 0

  for (const messageID of messageIds) {
    const partDir = join(getPartStorage(), messageID)
    if (!existsSync(partDir)) continue

    for (const file of readdirSync(partDir)) {
      if (!file.endsWith(".json")) continue
      const partPath = join(partDir, file)

      try {
        const content = readFileSync(partPath, "utf-8")
        const part = JSON.parse(content) as StoredToolPart

        if (part.type !== "tool" || !part.callID) continue
        if (!callIds.has(part.callID)) continue
        if (!part.state?.output || part.truncated) continue

        const result = truncateToolResult(partPath)
        if (result.success) {
          truncatedCount++
        }
      } catch {
        continue
      }
    }
  }

  if (truncatedCount > 0) {
    log("[auto-compact] pruned duplicate tool outputs", {
      sessionID,
      truncatedCount,
    })
  }

  return { truncatedCount }
}

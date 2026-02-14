import { existsSync, readdirSync } from "node:fs"
import { getMessageDir } from "../../shared/opencode-message-dir"

export { getMessageDir }

export function getMessageIds(sessionID: string): string[] {
  const messageDir = getMessageDir(sessionID)
  if (!messageDir || !existsSync(messageDir)) return []

  const messageIds: string[] = []
  for (const file of readdirSync(messageDir)) {
    if (!file.endsWith(".json")) continue
    const messageId = file.replace(".json", "")
    messageIds.push(messageId)
  }

  return messageIds
}

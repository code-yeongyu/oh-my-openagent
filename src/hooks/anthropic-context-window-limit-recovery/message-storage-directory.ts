import { existsSync, readdirSync } from "node:fs"
import type { PluginInput } from "@opencode-ai/plugin"
import { getMessageDir } from "../../shared/opencode-message-dir"
import { normalizeSDKResponse } from "../../shared"

export { getMessageDir }

type OpencodeClient = PluginInput["client"]

interface SDKMessage {
  info: { id: string }
  parts: unknown[]
}

export async function getMessageIdsFromSDK(
  client: OpencodeClient,
  sessionID: string
): Promise<string[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as SDKMessage[], { preferResponseOnMissingData: true })
    return messages.map(msg => msg.info.id)
  } catch {
    return []
  }
}

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

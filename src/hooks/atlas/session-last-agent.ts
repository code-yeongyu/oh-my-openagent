import type { PluginInput } from "@opencode-ai/plugin"

import { findNearestMessageWithFields } from "../../features/hook-message-injector"
import { findNearestMessageWithFieldsFromSDK } from "../../features/hook-message-injector"
import { getMessageDir, isSqliteBackend } from "../../shared"

type OpencodeClient = PluginInput["client"]

export async function getLastAgentFromSession(
  sessionID: string,
  client?: OpencodeClient
): Promise<string | null> {
  let nearest = null

  if (isSqliteBackend() && client) {
    nearest = await findNearestMessageWithFieldsFromSDK(client, sessionID)
  } else {
    const messageDir = getMessageDir(sessionID)
    if (!messageDir) return null
    nearest = findNearestMessageWithFields(messageDir)
  }

  return nearest?.agent?.toLowerCase() ?? null
}

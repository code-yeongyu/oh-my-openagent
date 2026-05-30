import type { PluginInput } from "@opencode-ai/plugin"
import type { MessageData } from "../types"
import { log, normalizeSDKResponse } from "../../../shared"
import { readMessages } from "./messages-reader"

type OpencodeClient = PluginInput["client"]

export function isLatestAssistantMessage(sessionID: string, messageID: string): boolean {
  const messages = readMessages(sessionID)
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message?.role === "assistant") {
      return message.id === messageID
    }
  }
  return false
}

export async function isLatestAssistantMessageFromSDK(
  client: OpencodeClient,
  sessionID: string,
  messageID: string
): Promise<boolean> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    const messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })
    for (let index = messages.length - 1; index >= 0; index -= 1) {
      const message = messages[index]
      if (message?.info?.role === "assistant") {
        return message.info.id === messageID
      }
    }
  } catch (error) {
    log("[session-recovery] latest assistant lookup failed", {
      sessionID,
      messageID,
      error: String(error),
    })
  }

  return false
}

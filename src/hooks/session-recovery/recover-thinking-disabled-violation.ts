import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { MessageData } from "./types"
import { findMessagesWithThinkingBlocks, stripThinkingParts } from "./storage"

type Client = ReturnType<typeof createOpencodeClient>

export async function recoverThinkingDisabledViolation(
  _client: Client,
  sessionID: string,
  _failedAssistantMsg: MessageData
): Promise<boolean> {
  const messagesWithThinking = findMessagesWithThinkingBlocks(sessionID)
  if (messagesWithThinking.length === 0) {
    return false
  }

  let anySuccess = false
  for (const messageID of messagesWithThinking) {
    if (stripThinkingParts(messageID)) {
      anySuccess = true
    }
  }

  return anySuccess
}

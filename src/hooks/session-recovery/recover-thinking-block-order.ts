import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { MessageData } from "./types"
import { extractMessageIndex } from "./detect-error-type"
import { findMessageByIndexNeedingThinking, findMessagesWithOrphanThinking, prependThinkingPart } from "./storage"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { prependThinkingPartAsync } from "./storage/thinking-prepend"
import { THINKING_TYPES } from "./constants"
import { normalizeSDKResponse } from "../../shared"

type Client = ReturnType<typeof createOpencodeClient>

export async function recoverThinkingBlockOrder(
  client: Client,
  sessionID: string,
  _failedAssistantMsg: MessageData,
  _directory: string,
  error: unknown
): Promise<boolean> {
  if (isSqliteBackend()) {
    return recoverThinkingBlockOrderFromSDK(client, sessionID, error)
  }

  const targetIndex = extractMessageIndex(error)
  if (targetIndex !== null) {
    const targetMessageID = findMessageByIndexNeedingThinking(sessionID, targetIndex)
    if (targetMessageID) {
      return prependThinkingPart(sessionID, targetMessageID)
    }
  }

  const orphanMessages = findMessagesWithOrphanThinking(sessionID)
  if (orphanMessages.length === 0) {
    return false
  }

  let anySuccess = false
  for (const messageID of orphanMessages) {
    if (prependThinkingPart(sessionID, messageID)) {
      anySuccess = true
    }
  }

  return anySuccess
}

async function recoverThinkingBlockOrderFromSDK(
  client: Client,
  sessionID: string,
  error: unknown
): Promise<boolean> {
  const targetIndex = extractMessageIndex(error)
  if (targetIndex !== null) {
    const targetMessageID = await findMessageByIndexNeedingThinkingFromSDK(client, sessionID, targetIndex)
    if (targetMessageID) {
      return prependThinkingPartAsync(client, sessionID, targetMessageID)
    }
  }

  const orphanMessages = await findMessagesWithOrphanThinkingFromSDK(client, sessionID)
  if (orphanMessages.length === 0) {
    return false
  }

  let anySuccess = false
  for (const messageID of orphanMessages) {
    if (await prependThinkingPartAsync(client, sessionID, messageID)) {
      anySuccess = true
    }
  }

  return anySuccess
}

async function findMessagesWithOrphanThinkingFromSDK(
  client: Client,
  sessionID: string
): Promise<string[]> {
  let messages: MessageData[]
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })
  } catch {
    return []
  }

  const result: string[] = []
  for (const msg of messages) {
    if (msg.info?.role !== "assistant") continue
    if (!msg.info?.id) continue
    if (!msg.parts || msg.parts.length === 0) continue

    const partsWithIds = msg.parts.filter(
      (part): part is { id: string; type: string } => typeof part.id === "string"
    )
    if (partsWithIds.length === 0) continue

    const sortedParts = [...partsWithIds].sort((a, b) => a.id.localeCompare(b.id))
    const firstPart = sortedParts[0]
    if (!THINKING_TYPES.has(firstPart.type)) {
      result.push(msg.info.id)
    }
  }

  return result
}

async function findMessageByIndexNeedingThinkingFromSDK(
  client: Client,
  sessionID: string,
  targetIndex: number
): Promise<string | null> {
  let messages: MessageData[]
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    messages = normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })
  } catch {
    return null
  }

  if (targetIndex < 0 || targetIndex >= messages.length) return null

  const targetMessage = messages[targetIndex]
  if (targetMessage.info?.role !== "assistant") return null
  if (!targetMessage.info?.id) return null
  if (!targetMessage.parts || targetMessage.parts.length === 0) return null

  const partsWithIds = targetMessage.parts.filter(
    (part): part is { id: string; type: string } => typeof part.id === "string"
  )
  if (partsWithIds.length === 0) return null

  const sortedParts = [...partsWithIds].sort((a, b) => a.id.localeCompare(b.id))
  const firstPart = sortedParts[0]
  const firstIsThinking = THINKING_TYPES.has(firstPart.type)

  return firstIsThinking ? null : targetMessage.info.id
}

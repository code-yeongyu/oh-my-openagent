import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { MessageData } from "./types"
import { extractMessageIndex } from "./detect-error-type"
import { META_TYPES, THINKING_TYPES } from "./constants"
import { normalizeSDKResponse } from "../../shared"

type Client = ReturnType<typeof createOpencodeClient>

type ReplaceEmptyTextPartsAsync = (
  client: Client,
  sessionID: string,
  messageID: string,
  replacementText: string
) => Promise<boolean>

type InjectTextPartAsync = (
  client: Client,
  sessionID: string,
  messageID: string,
  text: string
) => Promise<boolean>

type FindMessagesWithEmptyTextPartsFromSDK = (
  client: Client,
  sessionID: string
) => Promise<string[]>

export async function recoverEmptyContentMessageFromSDK(
  client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData,
  error: unknown,
  dependencies: {
    placeholderText: string
    replaceEmptyTextPartsAsync: ReplaceEmptyTextPartsAsync
    injectTextPartAsync: InjectTextPartAsync
    findMessagesWithEmptyTextPartsFromSDK: FindMessagesWithEmptyTextPartsFromSDK
  }
): Promise<boolean> {
  const targetIndex = extractMessageIndex(error)
  const failedID = failedAssistantMsg.info?.id
  let anySuccess = false

  const messagesWithEmptyText = await dependencies.findMessagesWithEmptyTextPartsFromSDK(client, sessionID)
  for (const messageID of messagesWithEmptyText) {
    if (
      await dependencies.replaceEmptyTextPartsAsync(
        client,
        sessionID,
        messageID,
        dependencies.placeholderText
      )
    ) {
      anySuccess = true
    }
  }

  const messages = await readMessagesFromSDK(client, sessionID)

  const thinkingOnlyIDs = findMessagesWithThinkingOnlyFromSDK(messages)
  for (const messageID of thinkingOnlyIDs) {
    if (await dependencies.injectTextPartAsync(client, sessionID, messageID, dependencies.placeholderText)) {
      anySuccess = true
    }
  }

  if (targetIndex !== null) {
    const targetMessageID = findEmptyMessageByIndexFromSDK(messages, targetIndex)
    if (targetMessageID) {
      if (
        await dependencies.replaceEmptyTextPartsAsync(
          client,
          sessionID,
          targetMessageID,
          dependencies.placeholderText
        )
      ) {
        return true
      }
      if (await dependencies.injectTextPartAsync(client, sessionID, targetMessageID, dependencies.placeholderText)) {
        return true
      }
    }
  }

  if (failedID) {
    if (await dependencies.replaceEmptyTextPartsAsync(client, sessionID, failedID, dependencies.placeholderText)) {
      return true
    }
    if (await dependencies.injectTextPartAsync(client, sessionID, failedID, dependencies.placeholderText)) {
      return true
    }
  }

  const freshMessages = await readMessagesFromSDK(client, sessionID)
  const emptyMessageIDs = findEmptyMessagesFromSDK(freshMessages)
  for (const messageID of emptyMessageIDs) {
    if (
      await dependencies.replaceEmptyTextPartsAsync(
        client,
        sessionID,
        messageID,
        dependencies.placeholderText
      )
    ) {
      anySuccess = true
    }
    if (await dependencies.injectTextPartAsync(client, sessionID, messageID, dependencies.placeholderText)) {
      anySuccess = true
    }
  }

  return anySuccess
}

type SdkPart = NonNullable<MessageData["parts"]>[number]

function sdkPartHasContent(part: SdkPart): boolean {
  if (THINKING_TYPES.has(part.type)) return false
  if (META_TYPES.has(part.type)) return false

  if (part.type === "text") {
    return !!part.text?.trim()
  }

  if (part.type === "tool" || part.type === "tool_use" || part.type === "tool_result") {
    return true
  }

  return true
}

function sdkMessageHasContent(message: MessageData): boolean {
  return (message.parts ?? []).some(sdkPartHasContent)
}

async function readMessagesFromSDK(client: Client, sessionID: string): Promise<MessageData[]> {
  try {
    const response = await client.session.messages({ path: { id: sessionID } })
    return normalizeSDKResponse(response, [] as MessageData[], { preferResponseOnMissingData: true })
  } catch {
    return []
  }
}

function findMessagesWithThinkingOnlyFromSDK(messages: MessageData[]): string[] {
  const result: string[] = []

  for (const msg of messages) {
    if (msg.info?.role !== "assistant") continue
    if (!msg.info?.id) continue
    if (!msg.parts || msg.parts.length === 0) continue

    const hasThinking = msg.parts.some((part) => THINKING_TYPES.has(part.type))
    const hasContent = msg.parts.some(sdkPartHasContent)

    if (hasThinking && !hasContent) {
      result.push(msg.info.id)
    }
  }

  return result
}

function findEmptyMessagesFromSDK(messages: MessageData[]): string[] {
  const emptyIds: string[] = []

  for (const msg of messages) {
    if (!msg.info?.id) continue
    if (!sdkMessageHasContent(msg)) {
      emptyIds.push(msg.info.id)
    }
  }

  return emptyIds
}

function findEmptyMessageByIndexFromSDK(messages: MessageData[], targetIndex: number): string | null {
  const indicesToTry = [
    targetIndex,
    targetIndex - 1,
    targetIndex + 1,
    targetIndex - 2,
    targetIndex + 2,
    targetIndex - 3,
    targetIndex - 4,
    targetIndex - 5,
  ]

  for (const index of indicesToTry) {
    if (index < 0 || index >= messages.length) continue
    const targetMessage = messages[index]
    if (!targetMessage.info?.id) continue

    if (!sdkMessageHasContent(targetMessage)) {
      return targetMessage.info.id
    }
  }

  return null
}

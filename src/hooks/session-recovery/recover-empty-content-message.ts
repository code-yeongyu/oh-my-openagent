import type { createOpencodeClient } from "@opencode-ai/sdk"
import type { MessageData } from "./types"
import { extractMessageIndex } from "./detect-error-type"
import { recoverEmptyContentMessageFromSDK } from "./recover-empty-content-message-sdk"
import {
  findEmptyMessageByIndex,
  findEmptyMessages,
  findMessagesWithEmptyTextParts,
  findMessagesWithThinkingOnly,
  injectTextPart,
  replaceEmptyTextParts,
} from "./storage"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import { replaceEmptyTextPartsAsync, findMessagesWithEmptyTextPartsFromSDK } from "./storage/empty-text"
import { injectTextPartAsync } from "./storage/text-part-injector"

type Client = ReturnType<typeof createOpencodeClient>

const PLACEHOLDER_TEXT = "[user interrupted]"

export async function recoverEmptyContentMessage(
  client: Client,
  sessionID: string,
  failedAssistantMsg: MessageData,
  _directory: string,
  error: unknown
): Promise<boolean> {
  if (isSqliteBackend()) {
    return recoverEmptyContentMessageFromSDK(client, sessionID, failedAssistantMsg, error, {
      placeholderText: PLACEHOLDER_TEXT,
      replaceEmptyTextPartsAsync,
      injectTextPartAsync,
      findMessagesWithEmptyTextPartsFromSDK,
    })
  }

  const targetIndex = extractMessageIndex(error)
  const failedID = failedAssistantMsg.info?.id
  let anySuccess = false

  const messagesWithEmptyText = findMessagesWithEmptyTextParts(sessionID)
  for (const messageID of messagesWithEmptyText) {
    if (replaceEmptyTextParts(messageID, PLACEHOLDER_TEXT)) {
      anySuccess = true
    }
  }

  const thinkingOnlyIDs = findMessagesWithThinkingOnly(sessionID)
  for (const messageID of thinkingOnlyIDs) {
    if (injectTextPart(sessionID, messageID, PLACEHOLDER_TEXT)) {
      anySuccess = true
    }
  }

  if (targetIndex !== null) {
    const targetMessageID = findEmptyMessageByIndex(sessionID, targetIndex)
    if (targetMessageID) {
      if (replaceEmptyTextParts(targetMessageID, PLACEHOLDER_TEXT)) {
        return true
      }
      if (injectTextPart(sessionID, targetMessageID, PLACEHOLDER_TEXT)) {
        return true
      }
    }
  }

  if (failedID) {
    if (replaceEmptyTextParts(failedID, PLACEHOLDER_TEXT)) {
      return true
    }
    if (injectTextPart(sessionID, failedID, PLACEHOLDER_TEXT)) {
      return true
    }
  }

  const emptyMessageIDs = findEmptyMessages(sessionID)
  for (const messageID of emptyMessageIDs) {
    if (replaceEmptyTextParts(messageID, PLACEHOLDER_TEXT)) {
      anySuccess = true
    }
    if (injectTextPart(sessionID, messageID, PLACEHOLDER_TEXT)) {
      anySuccess = true
    }
  }

  return anySuccess
}

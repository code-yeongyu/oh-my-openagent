import {
  findEmptyMessages,
  findEmptyMessageByIndex,
  findMessagesWithEmptyTextParts,
  injectTextPart,
  replaceEmptyTextParts,
} from "../session-recovery/storage"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import type { AutoCompactState } from "./types"
import type { Client } from "./client"
import { PLACEHOLDER_TEXT } from "./message-builder"
import { incrementEmptyContentAttempt } from "./state"
import { fixEmptyMessagesWithSDK } from "./empty-content-recovery-sdk"
import { log } from "../../shared/logger"

async function showToastSafely(
  client: Client,
  body: {
    title: string
    message: string
    variant: "error" | "warning" | "success"
    duration: number
  },
  failureContext: string,
): Promise<void> {
  try {
    await client.tui.showToast({ body })
  } catch (error) {
    log(`[auto-compact] failed to show toast: ${failureContext}`, {
      title: body.title,
      error: error instanceof Error ? error.message : String(error),
    })
  }
}

export async function fixEmptyMessages(params: {
  sessionID: string
  autoCompactState: AutoCompactState
  client: Client
  messageIndex?: number
}): Promise<boolean> {
  incrementEmptyContentAttempt(params.autoCompactState, params.sessionID)

  let fixed = false
  const fixedMessageIds: string[] = []

  if (isSqliteBackend()) {
    const result = await fixEmptyMessagesWithSDK({
      sessionID: params.sessionID,
      client: params.client,
      placeholderText: PLACEHOLDER_TEXT,
      messageIndex: params.messageIndex,
    })

    if (!result.fixed && result.scannedEmptyCount === 0) {
      await showToastSafely(
        params.client,
        {
          title: "Empty Content Error",
          message: "No empty messages found in storage. Cannot auto-recover.",
          variant: "error",
          duration: 5000,
        },
        "sqlite empty message not found",
      )
      return false
    }

    if (result.fixed) {
      await showToastSafely(
        params.client,
        {
          title: "Session Recovery",
          message: `Fixed ${result.fixedMessageIds.length} empty message(s). Retrying...`,
          variant: "warning",
          duration: 3000,
        },
        "sqlite empty message fixed",
      )
    }

    return result.fixed
  }

  if (params.messageIndex !== undefined) {
    const targetMessageId = findEmptyMessageByIndex(params.sessionID, params.messageIndex)
    if (targetMessageId) {
      const replaced = replaceEmptyTextParts(targetMessageId, PLACEHOLDER_TEXT)
      if (replaced) {
        fixed = true
        fixedMessageIds.push(targetMessageId)
      } else {
        const injected = injectTextPart(params.sessionID, targetMessageId, PLACEHOLDER_TEXT)
        if (injected) {
          fixed = true
          fixedMessageIds.push(targetMessageId)
        }
      }
    }
  }

  if (!fixed) {
    const emptyMessageIds = findEmptyMessages(params.sessionID)
    const emptyTextPartIds = findMessagesWithEmptyTextParts(params.sessionID)
    const allIds = [...new Set([...emptyMessageIds, ...emptyTextPartIds])]
    if (allIds.length === 0) {
      await showToastSafely(
        params.client,
        {
          title: "Empty Content Error",
          message: "No empty messages found in storage. Cannot auto-recover.",
          variant: "error",
          duration: 5000,
        },
        "empty message not found",
      )
      return false
    }

    for (const messageID of allIds) {
      const replaced = replaceEmptyTextParts(messageID, PLACEHOLDER_TEXT)
      if (replaced) {
        fixed = true
        fixedMessageIds.push(messageID)
      } else {
        const injected = injectTextPart(params.sessionID, messageID, PLACEHOLDER_TEXT)
        if (injected) {
          fixed = true
          fixedMessageIds.push(messageID)
        }
      }
    }
  }

  if (fixed) {
    await showToastSafely(
      params.client,
      {
        title: "Session Recovery",
        message: `Fixed ${fixedMessageIds.length} empty message(s). Retrying...`,
        variant: "warning",
        duration: 3000,
      },
      "empty messages fixed",
    )
  }

  return fixed
}

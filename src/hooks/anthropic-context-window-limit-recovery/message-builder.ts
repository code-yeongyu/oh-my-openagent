import { log } from "../../shared/logger"
import type { PluginInput } from "@opencode-ai/plugin"
import { normalizeSDKResponse } from "../../shared"
import { isSqliteBackend } from "../../shared/opencode-storage-detection"
import {
  findEmptyMessages,
  injectTextPart,
  replaceEmptyTextParts,
} from "../session-recovery/storage"
import { replaceEmptyTextPartsAsync } from "../session-recovery/storage/empty-text"
import { injectTextPartAsync } from "../session-recovery/storage/text-part-injector"
import type { Client } from "./client"

export const PLACEHOLDER_TEXT = "[user interrupted]"

type OpencodeClient = PluginInput["client"]

interface SDKPart {
  type?: string
  text?: string
}

interface SDKMessage {
  info?: { id?: string }
  parts?: SDKPart[]
}

const IGNORE_TYPES = new Set(["thinking", "redacted_thinking", "meta"])
const TOOL_TYPES = new Set(["tool", "tool_use", "tool_result"])

function messageHasContentFromSDK(message: SDKMessage): boolean {
  const parts = message.parts
  if (!parts || parts.length === 0) return false

  for (const part of parts) {
    const type = part.type
    if (!type) continue
    if (IGNORE_TYPES.has(type)) {
      continue
    }

    if (type === "text") {
      if (part.text?.trim()) return true
      continue
    }

    if (TOOL_TYPES.has(type)) return true

    return true
  }

  // Messages with only thinking/meta parts are treated as empty
  // to align with file-based logic (messageHasContent)
  return false
}

async function findEmptyMessageIdsFromSDK(
  client: OpencodeClient,
  sessionID: string,
): Promise<string[]> {
  try {
    const response = (await client.session.messages({
      path: { id: sessionID },
    })) as { data?: SDKMessage[] }
    const messages = normalizeSDKResponse(response, [] as SDKMessage[], { preferResponseOnMissingData: true })

    const emptyIds: string[] = []
    for (const message of messages) {
      const messageID = message.info?.id
      if (!messageID) continue
      if (!messageHasContentFromSDK(message)) {
        emptyIds.push(messageID)
      }
    }

    return emptyIds
  } catch {
    return []
  }
}

export async function sanitizeEmptyMessagesBeforeSummarize(
  sessionID: string,
  client?: OpencodeClient,
): Promise<number> {
  if (client && isSqliteBackend()) {
    const emptyMessageIds = await findEmptyMessageIdsFromSDK(client, sessionID)
    if (emptyMessageIds.length === 0) {
      return 0
    }

    let fixedCount = 0
    for (const messageID of emptyMessageIds) {
      const replaced = await replaceEmptyTextPartsAsync(client, sessionID, messageID, PLACEHOLDER_TEXT)
      if (replaced) {
        fixedCount++
      } else {
        const injected = await injectTextPartAsync(client, sessionID, messageID, PLACEHOLDER_TEXT)
        if (injected) {
          fixedCount++
        }
      }
    }

    if (fixedCount > 0) {
      log("[auto-compact] pre-summarize sanitization fixed empty messages", {
        sessionID,
        fixedCount,
        totalEmpty: emptyMessageIds.length,
      })
    }

    return fixedCount
  }

  const emptyMessageIds = findEmptyMessages(sessionID)
  if (emptyMessageIds.length === 0) {
    return 0
  }

  let fixedCount = 0
  for (const messageID of emptyMessageIds) {
    const replaced = replaceEmptyTextParts(messageID, PLACEHOLDER_TEXT)
    if (replaced) {
      fixedCount++
    } else {
      const injected = injectTextPart(sessionID, messageID, PLACEHOLDER_TEXT)
      if (injected) {
        fixedCount++
      }
    }
  }

  if (fixedCount > 0) {
    log("[auto-compact] pre-summarize sanitization fixed empty messages", {
      sessionID,
      fixedCount,
      totalEmpty: emptyMessageIds.length,
    })
  }

  return fixedCount
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`
}

export async function getLastAssistant(
  sessionID: string,
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  client: any,
  directory: string,
): Promise<Record<string, unknown> | null> {
  try {
    const resp = await (client as Client).session.messages({
      path: { id: sessionID },
      query: { directory },
    })

    const data = (resp as { data?: unknown[] }).data
    if (!Array.isArray(data)) return null

    const reversed = [...data].reverse()
    const last = reversed.find((m) => {
      const msg = m as Record<string, unknown>
      const info = msg.info as Record<string, unknown> | undefined
      return info?.role === "assistant"
    })
    if (!last) return null
    return (last as { info?: Record<string, unknown> }).info ?? null
  } catch {
    return null
  }
}

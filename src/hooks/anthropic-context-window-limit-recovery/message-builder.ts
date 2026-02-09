import { log } from "../../shared/logger"
import {
  findEmptyMessages,
  injectTextPart,
  replaceEmptyTextParts,
} from "../session-recovery/storage"
import type { Client } from "./client"

export const PLACEHOLDER_TEXT = "[user interrupted]"

export function sanitizeEmptyMessagesBeforeSummarize(sessionID: string): number {
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

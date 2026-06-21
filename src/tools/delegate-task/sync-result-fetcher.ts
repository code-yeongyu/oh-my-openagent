import { normalizeSDKResponse } from "../../shared"
import type { SessionMessage } from "./executor-types"
import type { OpencodeClient } from "./types"

/**
 * Extract all text (text + reasoning parts) from a session message.
 */
function messageText(msg: SessionMessage): string {
  const textParts = msg.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
  return textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")
}

/**
 * Final text variant: strips outer markdown code fences if the entire
 * message is wrapped in a fenced code block. This prevents the parent
 * from receiving double-wrapped delimiters.
 */
function messageFinalText(msg: SessionMessage): string {
  const text = messageText(msg)
  const trimmed = text.trim()
  if (trimmed.startsWith("```") && trimmed.endsWith("```")) {
    const inner = trimmed.slice(3, -3).trim()
    const firstNewline = inner.indexOf("\n")
    if (firstNewline > 0 && firstNewline < 100) {
      return inner.slice(firstNewline + 1).trim()
    }
    return inner
  }
  return trimmed
}

/**
 * Extract content wrapped in a deliverable tag (e.g., <plan>...</plan>).
 * Returns the first tagged assistant message, newest first.
 */
function extractTaggedDeliverable(
  messages: SessionMessage[],
  tag: string
): { message: SessionMessage; text: string } | undefined {
  const tagStart = `<${tag}>`
  const tagEnd = `</${tag}>`
  // Search newest-first for tagged content
  for (let i = messages.length - 1; i >= 0; i--) {
    const msg = messages[i]
    if (msg.info?.role !== "assistant") continue
    const text = messageText(msg)
    const startIdx = text.indexOf(tagStart)
    if (startIdx === -1) continue
    const endIdx = text.indexOf(tagEnd, startIdx + tagStart.length)
    if (endIdx === -1) continue
    return {
      message: msg,
      text: text.slice(startIdx + tagStart.length, endIdx).trim(),
    }
  }
  return undefined
}

export type FetchSyncResultOptions = {
  deliverableTag?: string
  finalTextOnly?: boolean
}

export async function fetchSyncResult(
  client: OpencodeClient,
  sessionID: string,
  anchorMessageCount?: number,
  options?: FetchSyncResultOptions
): Promise<{ ok: true; textContent: string } | { ok: false; error: string }> {
  const messagesResult = await client.session.messages({
    path: { id: sessionID },
  })

  if ((messagesResult as { error?: unknown }).error) {
    return { ok: false, error: `Error fetching result: ${(messagesResult as { error: unknown }).error}\n\nSession ID: ${sessionID}` }
  }

  const messages = normalizeSDKResponse(messagesResult, [] as SessionMessage[], {
    preferResponseOnMissingData: true,
  })

  const messagesAfterAnchor = anchorMessageCount !== undefined ? messages.slice(anchorMessageCount) : messages

  if (anchorMessageCount !== undefined && messagesAfterAnchor.length === 0) {
    return {
      ok: false,
      error: `Session completed but no new response was generated. The model may have failed silently.\n\nSession ID: ${sessionID}`,
    }
  }

  // If deliverableTag is set, prioritize tagged content over the naive latest message
  if (options?.deliverableTag) {
    const tagged = extractTaggedDeliverable(messagesAfterAnchor, options.deliverableTag)
    if (tagged) {
      const textContent = options.finalTextOnly ? messageFinalText(tagged.message) : tagged.text
      return { ok: true, textContent }
    }
    // No tagged message found — fall through to normal latest-message logic
  }

  const assistantMessages = messagesAfterAnchor
    .filter((m) => m.info?.role === "assistant")
    .sort((a, b) => (b.info?.time?.created ?? 0) - (a.info?.time?.created ?? 0))
  const lastMessage = assistantMessages[0]

  if (anchorMessageCount !== undefined && !lastMessage) {
    return {
      ok: false,
      error: `Session completed but no new response was generated. The model may have failed silently.\n\nSession ID: ${sessionID}`,
    }
  }

  if (!lastMessage) {
    return { ok: false, error: `No assistant response found.\n\nSession ID: ${sessionID}` }
  }

  const textContent = options?.finalTextOnly
    ? messageFinalText(lastMessage)
    : messageText(lastMessage)

  return { ok: true, textContent }
}

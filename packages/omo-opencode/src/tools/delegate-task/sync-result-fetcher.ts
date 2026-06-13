import type { OpencodeClient } from "./types"
import type { SessionMessage } from "./executor-types"
import { normalizeSDKResponse } from "../../shared"

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

function messageText(msg: SessionMessage): string {
  return (msg.parts ?? [])
    .filter((p) => p.type === "text" || p.type === "reasoning")
    .map((p) => p.text ?? "")
    .filter(Boolean)
    .join("\n")
}

/**
 * Select the deliverable by an explicit envelope tag (e.g. `<plan>...</plan>`)
 * instead of guessing by recency. The subagent marks its real deliverable with
 * the tag; progress/notification-triggered turns do not carry it, so this
 * deterministically resolves the multi-turn ambiguity that arises when a sync
 * subagent launches its own background tasks. Returns the contents of the
 * newest message containing a complete tag block, or undefined to fall back.
 */
function extractTaggedDeliverable(assistantMessages: SessionMessage[], tag: string): string | undefined {
  const pattern = new RegExp(`<${escapeRegExp(tag)}>([\\s\\S]*)</${escapeRegExp(tag)}>`, "i")
  for (const msg of assistantMessages) {
    const match = pattern.exec(messageText(msg))
    if (match && match[1].trim()) {
      return match[1].trim()
    }
  }
  return undefined
}

export async function fetchSyncResult(
  client: OpencodeClient,
  sessionID: string,
  anchorMessageCount?: number,
  options?: { strictAbortRecovery?: boolean; deliverableTag?: string }
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

  // Prefer an explicit deliverable envelope (e.g. `<plan>...</plan>`) when the
  // agent is expected to emit one. This selects the turn the agent marked as its
  // deliverable rather than the newest turn, which is what makes extraction
  // correct when post-completion (notification-triggered) turns exist. A missing
  // or unclosed envelope falls through to the recency-based behavior below.
  if (options?.deliverableTag) {
    const tagged = extractTaggedDeliverable(assistantMessages, options.deliverableTag)
    if (tagged) {
      return { ok: true, textContent: tagged }
    }
  }

  if (options?.strictAbortRecovery) {
    if (lastMessage.info && "error" in lastMessage.info) {
      return {
        ok: false,
        error: `Latest assistant message is an error; refusing abort recovery.\n\nSession ID: ${sessionID}`,
      }
    }

    const lastTextParts = lastMessage.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
    const lastContent = lastTextParts.map((p) => p.text ?? "").filter(Boolean).join("\n")
    if (!lastContent) {
      return {
        ok: false,
        error: `No assistant text output found in latest response.\n\nSession ID: ${sessionID}`,
      }
    }

    return { ok: true, textContent: lastContent }
  }

  // Search assistant messages (newest first) for one with text/reasoning content.
  // The last assistant message may only contain tool calls with no text.
  let textContent = ""
  for (const msg of assistantMessages) {
    const textParts = msg.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
    const content = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")
    if (content) {
      textContent = content
      break
    }
  }

  if (!textContent) {
    return {
      ok: false,
      error: `No assistant text output found in completed response.\n\nSession ID: ${sessionID}`,
    }
  }

  return { ok: true, textContent }
}

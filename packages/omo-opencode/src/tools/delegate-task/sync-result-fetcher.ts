import type { OpencodeClient } from "./types"
import type { SessionMessage } from "./executor-types"
import { normalizeSDKResponse } from "../../shared"
import { truncateToTokenBudget } from "./token-limiter"

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
}

// Caps the text returned to the parent so an oversized subagent deliverable
// cannot saturate the parent context. The post-tool truncator hook skips the
// task tool, so the cap must be applied here on the fetch path. Sized to match
// OpenCode's tool_output.max_bytes default (~51200 bytes ≈ 12800 tokens); the
// full transcript stays available via background_output.
const DEFAULT_MAX_SYNC_RESULT_TOKENS = 12_800

function capSyncResult(content: string, maxTokens: number): string {
  if (maxTokens <= 0) return content
  return truncateToTokenBudget(content, maxTokens)
}

function messageText(msg: SessionMessage): string {
  return (msg.parts ?? [])
    .filter((p) => p.type === "text" || p.type === "reasoning")
    .map((p) => p.text ?? "")
    .filter(Boolean)
    .join("\n")
}

// Final text output only — excludes reasoning. The deliverable envelope applies
// to the agent's final response, not its chain-of-thought, so envelope selection
// must not pick up a complete `<plan>...</plan>` that the model merely sketched
// inside a reasoning part (which would otherwise win over an untagged or
// malformed final text and suppress the correct recency fallback).
function messageFinalText(msg: SessionMessage): string {
  return (msg.parts ?? [])
    .filter((p) => p.type === "text")
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
  const escaped = escapeRegExp(tag)
  // Non-greedy + global so a message containing multiple complete envelopes
  // (e.g. a reasoning-part draft `<plan>...</plan>` followed by the final
  // text-part `<plan>...</plan>`) yields the LAST block rather than a greedy
  // span from the first opener to the last closer.
  const pattern = new RegExp(`<${escaped}>([\\s\\S]*?)</${escaped}>`, "gi")
  for (const msg of assistantMessages) {
    const text = messageFinalText(msg)
    let last: string | undefined
    for (const match of text.matchAll(pattern)) {
      const inner = match[1].trim()
      if (inner) last = inner
    }
    if (last) return last
  }
  return undefined
}

export async function fetchSyncResult(
  client: OpencodeClient,
  sessionID: string,
  anchorMessageCount?: number,
  options?: {
    strictAbortRecovery?: boolean
    deliverableTag?: string
    maxTokens?: number
  }
): Promise<{ ok: true; textContent: string } | { ok: false; error: string }> {
  const maxTokens = options?.maxTokens ?? DEFAULT_MAX_SYNC_RESULT_TOKENS
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

  // Abort recovery must validate the LATEST assistant message before accepting
  // any older content. Otherwise a provider abort/error on the newest turn could
  // be masked by returning a stale envelope from an earlier turn — reporting a
  // failed task as a successful completion. So the error/empty guard runs first;
  // only once the latest message is known-clean do we prefer the envelope.
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

    if (options.deliverableTag) {
      const tagged = extractTaggedDeliverable(assistantMessages, options.deliverableTag)
      if (tagged) {
        return { ok: true, textContent: capSyncResult(tagged, maxTokens) }
      }
    }

    return { ok: true, textContent: capSyncResult(lastContent, maxTokens) }
  }

  // Prefer an explicit deliverable envelope (e.g. `<plan>...</plan>`) when the
  // agent is expected to emit one. This selects the turn the agent marked as its
  // deliverable rather than the newest turn, which is what makes extraction
  // correct when post-completion (notification-triggered) turns exist. A missing
  // or unclosed envelope falls through to the recency-based behavior below.
  if (options?.deliverableTag) {
    const tagged = extractTaggedDeliverable(assistantMessages, options.deliverableTag)
    if (tagged) {
      return { ok: true, textContent: capSyncResult(tagged, maxTokens) }
    }
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

  return { ok: true, textContent: capSyncResult(textContent, maxTokens) }
}

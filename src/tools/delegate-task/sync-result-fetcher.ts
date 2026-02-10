import type { OpencodeClient } from "./types"
import type { SessionMessage } from "./executor-types"

export async function fetchSyncResult(
  client: OpencodeClient,
  sessionID: string,
  anchorMessageCount?: number
): Promise<{ ok: true; textContent: string } | { ok: false; error: string }> {
  const messagesResult = await client.session.messages({
    path: { id: sessionID },
  })

  if ((messagesResult as { error?: unknown }).error) {
    return { ok: false, error: `Error fetching result: ${(messagesResult as { error: unknown }).error}\n\nSession ID: ${sessionID}` }
  }

  const messages = ((messagesResult as { data?: unknown }).data ?? messagesResult) as SessionMessage[]

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

  const textParts = lastMessage?.parts?.filter((p) => p.type === "text" || p.type === "reasoning") ?? []
  const textContent = textParts.map((p) => p.text ?? "").filter(Boolean).join("\n")

  return { ok: true, textContent }
}

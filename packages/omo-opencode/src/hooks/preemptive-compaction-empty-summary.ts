import { normalizeSDKResponse } from "../shared/normalize-sdk-response"

interface MessagePart {
  type?: unknown
  text?: unknown
}

interface SessionMessage {
  info?: {
    id?: string
    role?: string
    summary?: unknown
    tokens?: { output?: number }
  }
  parts?: MessagePart[]
}

/**
 * A compaction is "empty" when it wrote a summary message that carries no text at all
 * (observed: a summarize whose provider stream died mid-flight produced `summary: true`
 * with zero parts and zero output tokens). Such a summary replaces the conversation with
 * nothing, so it must never be treated as a successful compaction.
 */
export function isEmptySummaryMessage(message: SessionMessage | undefined): boolean {
  if (!message) return false

  const parts = message.parts
  const hasText = Array.isArray(parts) && parts.some((part) => {
    if (part?.type !== "text") return false
    return typeof part.text === "string" && part.text.trim().length > 0
  })
  if (hasText) return false

  const isSummary = message.info?.summary === true
  const hasNoParts = Array.isArray(parts) && parts.length === 0
  if (!isSummary && !hasNoParts) return false

  return (message.info?.tokens?.output ?? 0) === 0
}

export async function resolveEmptySummaryFromSession(args: {
  client: {
    session: {
      messages: (input: {
        path: { id: string }
        query?: { directory: string }
      }) => Promise<unknown>
    }
  }
  sessionID: string
  directory: string
}): Promise<boolean> {
  const { client, sessionID, directory } = args

  try {
    const response = await client.session.messages({
      path: { id: sessionID },
      query: { directory },
    })

    const messages = normalizeSDKResponse(response, [] as SessionMessage[], {
      preferResponseOnMissingData: true,
    })
    if (!Array.isArray(messages) || messages.length === 0) return false

    const target = messages[messages.length - 1]
    if (target?.info?.role !== "assistant") return false

    return isEmptySummaryMessage(target)
  } catch {
    return false
  }
}

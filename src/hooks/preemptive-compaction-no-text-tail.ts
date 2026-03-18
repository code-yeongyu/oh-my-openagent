import { normalizeSDKResponse } from "../shared/normalize-sdk-response"

const STEP_ONLY_TYPES = new Set(["step-start", "step-finish"])

interface MessagePart {
  type?: unknown
  text?: unknown
}

interface SessionMessage {
  info?: {
    id?: string
    role?: string
  }
  parts?: MessagePart[]
}

export function isStepOnlyNoTextParts(parts: unknown): boolean {
  if (!Array.isArray(parts) || parts.length === 0) return false

  return parts.every((part) => {
    const type = (part as MessagePart | undefined)?.type
    if (typeof type !== "string") return false
    if (!STEP_ONLY_TYPES.has(type)) return false

    const text = (part as MessagePart | undefined)?.text
    if (typeof text === "string" && text.trim().length > 0) return false
    return true
  })
}

function findMessageByID(messages: SessionMessage[], messageID?: string): SessionMessage | undefined {
  if (!messageID) return undefined
  return messages.find((message) => message.info?.id === messageID)
}

export async function resolveNoTextTailFromSession(args: {
  client: {
    session: {
      messages: (input: {
        path: { id: string }
        query?: { directory: string }
      }) => Promise<unknown>
    }
  }
  sessionID: string
  messageID?: string
  directory: string
}): Promise<boolean> {
  const { client, sessionID, messageID, directory } = args

  try {
    const response = await client.session.messages({
      path: { id: sessionID },
      query: { directory },
    })

    const messages = normalizeSDKResponse(response, [] as SessionMessage[], {
      preferResponseOnMissingData: true,
    })
    if (!Array.isArray(messages) || messages.length === 0) return false

    const target = findMessageByID(messages, messageID) ?? messages[messages.length - 1]
    if (target.info?.role !== "assistant") return false

    return isStepOnlyNoTextParts(target.parts)
  } catch {
    return false
  }
}

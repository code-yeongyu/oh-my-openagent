type MessageTime = { created?: number }

type MessageInfo = {
  role?: string
  time?: MessageTime
}

type MessagePart = {
  type?: string
  text?: string
}

type SessionMessage = {
  info?: MessageInfo
  parts?: unknown
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asSessionMessage(value: unknown): SessionMessage | null {
  if (!isObject(value)) return null
  const info = value["info"]
  const parts = value["parts"]
  return {
    info: isObject(info)
      ? {
          role: typeof info["role"] === "string" ? info["role"] : undefined,
          time: isObject(info["time"]) ? { created: typeof info["time"]["created"] === "number" ? info["time"]["created"] : undefined } : undefined,
        }
      : undefined,
    parts,
  }
}

function getCreatedTime(message: SessionMessage): number {
  return message.info?.time?.created ?? 0
}

function getTextParts(message: SessionMessage): MessagePart[] {
  if (!Array.isArray(message.parts)) return []
  return message.parts
    .filter((part): part is Record<string, unknown> => isObject(part))
    .map((part) => ({
      type: typeof part["type"] === "string" ? part["type"] : undefined,
      text: typeof part["text"] === "string" ? part["text"] : undefined,
    }))
    .filter((part) => part.type === "text" && Boolean(part.text))
}

export function extractLatestAssistantText(messages: unknown): string | null {
  return extractLatestAssistantOutcome(messages).text
}

export interface AssistantOutcome {
  text: string | null
  errorName: string | null
  hasAssistant: boolean
  completed: boolean
}

export function extractLatestAssistantOutcome(messages: unknown): AssistantOutcome {
  if (!Array.isArray(messages) || messages.length === 0) {
    return { text: null, errorName: null, hasAssistant: false, completed: false }
  }

  const parsed = messages
    .map(asSessionMessage)
    .filter((message): message is SessionMessage => message !== null)

  const assistantMessages = parsed
    .filter((message) => message.info?.role === "assistant")
    .sort((a, b) => getCreatedTime(b) - getCreatedTime(a))

  const hasAssistant = assistantMessages.length > 0
  const lastAssistantMessage = assistantMessages[0]

  if (!lastAssistantMessage) {
    return { text: null, errorName: null, hasAssistant, completed: false }
  }

  const textParts = getTextParts(lastAssistantMessage)
  const text = textParts.map((part) => part.text).join("\n") || null

  const allParts = Array.isArray(lastAssistantMessage.parts) ? lastAssistantMessage.parts : []
  const errorPart = allParts.find((part): part is Record<string, unknown> =>
    isObject(part) && typeof part["type"] === "string" && part["type"] === "error"
  )
  const errorName = errorPart && typeof errorPart["error"] === "string" ? errorPart["error"] : null

  const lastMessage = parsed[parsed.length - 1]
  const completed = lastMessage?.info?.role === "assistant"

  return { text, errorName, hasAssistant, completed }
}

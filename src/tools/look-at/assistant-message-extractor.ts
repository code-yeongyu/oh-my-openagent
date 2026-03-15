type MessageTime = { created?: number; completed?: number }

type MessageError = {
  name?: string
  data?: {
    message?: string
  }
}

type MessageInfo = {
  role?: string
  time?: MessageTime
  error?: MessageError
}

type MessagePart = {
  type?: string
  text?: string
}

type SessionMessage = {
  role?: string
  time?: MessageTime
  error?: MessageError
  info?: MessageInfo
  parts?: unknown
}

export interface AssistantExtractionOutcome {
  text: string | null
  hasAssistant: boolean
  completed: boolean
  errorName: string | null
  errorMessage: string | null
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

function asSessionMessage(value: unknown): SessionMessage | null {
  if (!isObject(value)) return null
  const info = value["info"]
  const parts = value["parts"]
  const topLevelError = value["error"]
  return {
    role: typeof value["role"] === "string" ? value["role"] : undefined,
    time: isObject(value["time"])
      ? {
          created: typeof value["time"]["created"] === "number" ? value["time"]["created"] : undefined,
          completed: typeof value["time"]["completed"] === "number" ? value["time"]["completed"] : undefined,
        }
      : undefined,
    error: isObject(topLevelError)
      ? {
          name: typeof topLevelError["name"] === "string" ? topLevelError["name"] : undefined,
          data: isObject(topLevelError["data"])
            ? {
                message: typeof topLevelError["data"]["message"] === "string" ? topLevelError["data"]["message"] : undefined,
              }
            : undefined,
        }
      : undefined,
    info: isObject(info)
      ? {
          role: typeof info["role"] === "string" ? info["role"] : undefined,
          time: isObject(info["time"])
            ? {
                created: typeof info["time"]["created"] === "number" ? info["time"]["created"] : undefined,
                completed: typeof info["time"]["completed"] === "number" ? info["time"]["completed"] : undefined,
              }
            : undefined,
          error: isObject(info["error"])
            ? {
                name: typeof info["error"]["name"] === "string" ? info["error"]["name"] : undefined,
                data: isObject(info["error"]["data"])
                  ? {
                      message: typeof info["error"]["data"]["message"] === "string" ? info["error"]["data"]["message"] : undefined,
                    }
                  : undefined,
              }
            : undefined,
        }
      : undefined,
    parts,
  }
}

function getCreatedTime(message: SessionMessage): number {
  return message.time?.created ?? message.info?.time?.created ?? 0
}

function getRole(message: SessionMessage): string | undefined {
  return message.role ?? message.info?.role
}

function getCompleted(message: SessionMessage): boolean {
  return Boolean(message.time?.completed ?? message.info?.time?.completed)
}

function getError(message: SessionMessage): MessageError | undefined {
  return message.error ?? message.info?.error
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

export function extractLatestAssistantOutcome(messages: unknown): AssistantExtractionOutcome {
  if (!Array.isArray(messages) || messages.length === 0) {
    return {
      text: null,
      hasAssistant: false,
      completed: false,
      errorName: null,
      errorMessage: null,
    }
  }

  const assistantMessages = messages
    .map(asSessionMessage)
    .filter((message): message is SessionMessage => message !== null)
    .filter((message) => getRole(message) === "assistant")
    .sort((a, b) => getCreatedTime(b) - getCreatedTime(a))

  const lastAssistantMessage = assistantMessages[0]
  if (!lastAssistantMessage) {
    return {
      text: null,
      hasAssistant: false,
      completed: false,
      errorName: null,
      errorMessage: null,
    }
  }

  const textParts = getTextParts(lastAssistantMessage)
  const responseText = textParts.map((part) => part.text).join("\n") || null
  const error = getError(lastAssistantMessage)

  return {
    text: responseText,
    hasAssistant: true,
    completed: getCompleted(lastAssistantMessage),
    errorName: error?.name ?? null,
    errorMessage: error?.data?.message ?? null,
  }
}

export function extractLatestAssistantText(messages: unknown): string | null {
  return extractLatestAssistantOutcome(messages).text
}

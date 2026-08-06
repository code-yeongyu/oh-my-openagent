type MessageTime = { created?: number }

type MessageInfo = {
  role?: string
  time?: MessageTime
}

type MessagePart = {
  type?: string
  text?: string
  content?: unknown
  reasoning?: string
  reasoningContent?: string
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

function asText(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value : undefined
}

function collectContentText(value: unknown): string[] {
  const directText = asText(value)
  if (directText) return [directText]

  if (!Array.isArray(value)) return []

  const texts: string[] = []
  for (const block of value) {
    if (!isObject(block)) continue
    const text = asText(block["text"]) ?? asText(block["content"])
    if (text) texts.push(text)
  }
  return texts
}

function normalizeThinkingText(text: string): string | null {
  const answerMatches = [...text.matchAll(/<answer\b[^>]*>([\s\S]*?)<\/answer>/gi)]
    .map((match) => match[1]?.trim())
    .filter((value): value is string => Boolean(value))
  const withoutThinking = text.replace(/<think\b[^>]*>[\s\S]*?<\/think>/gi, "").trim()
  const normalized = answerMatches.length > 0 ? answerMatches.join("\n") : withoutThinking
  return normalized.length > 0 ? normalized : null
}

function getTextParts(message: SessionMessage): MessagePart[] {
  if (!Array.isArray(message.parts)) return []
  return message.parts
    .filter((part): part is Record<string, unknown> => isObject(part))
    .map((part) => ({
      type: typeof part["type"] === "string" ? part["type"] : undefined,
      text: typeof part["text"] === "string" ? part["text"] : undefined,
      content: part["content"],
      reasoning: typeof part["reasoning"] === "string" ? part["reasoning"] : undefined,
      reasoningContent: typeof part["reasoning_content"] === "string" ? part["reasoning_content"] : undefined,
    }))
}

function extractTextFromParts(parts: MessagePart[]): string | null {
  const textCandidates: string[] = []
  const reasoningCandidates: string[] = []

  for (const part of parts) {
    const contentTexts = collectContentText(part.content)
    const directText = asText(part.text)

    if (part.type === "text") {
      if (directText) textCandidates.push(directText)
      textCandidates.push(...contentTexts)
    } else if (part.type === "reasoning" || part.type === "thinking") {
      if (directText) reasoningCandidates.push(directText)
      textCandidates.push(...contentTexts)
    }

    const reasoningText = asText(part.reasoningContent) ?? asText(part.reasoning)
    if (reasoningText) reasoningCandidates.push(reasoningText)
  }

  const primaryText = textCandidates.map(normalizeThinkingText).filter((text): text is string => text !== null).join("\n")
  if (primaryText) return primaryText

  return reasoningCandidates.map(normalizeThinkingText).filter((text): text is string => text !== null).join("\n") || null
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

  const text = extractTextFromParts(getTextParts(lastAssistantMessage))

  const allParts = Array.isArray(lastAssistantMessage.parts) ? lastAssistantMessage.parts : []
  const errorPart = allParts.find((part): part is Record<string, unknown> =>
    isObject(part) && typeof part["type"] === "string" && part["type"] === "error"
  )
  const errorName = errorPart && typeof errorPart["error"] === "string" ? errorPart["error"] : null

  const lastMessage = parsed[parsed.length - 1]
  const completed = lastMessage?.info?.role === "assistant"

  return { text, errorName, hasAssistant, completed }
}

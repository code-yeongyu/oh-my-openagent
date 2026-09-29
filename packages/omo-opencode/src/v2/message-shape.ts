function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null
}

const OMITTED_STORED_TYPES = new Set([
  "idle",
  "agent-switched",
  "model-switched",
  "location-switched",
])

export type V1Message = {
  info: Record<string, unknown>
  parts: Array<Record<string, unknown>>
}

function textPart(text: unknown): Array<Record<string, unknown>> {
  return [{ type: "text", text: typeof text === "string" ? text : "" }]
}

function partsFromContent(content: unknown): Array<Record<string, unknown>> {
  if (!Array.isArray(content)) return []
  return content.filter(isRecord).map((part) => ({ ...part }))
}

function contentFromParts(parts: Array<Record<string, unknown>>): Array<Record<string, unknown>> {
  return parts.map((part) => ({ ...part }))
}

function storedMessage(message: Record<string, unknown>, sessionID: string): V1Message | undefined {
  const type = message.type
  const id = message.id
  if (typeof type !== "string" || OMITTED_STORED_TYPES.has(type)) return undefined

  if (type === "assistant") {
    return {
      info: {
        id,
        sessionID,
        role: "assistant",
        agent: message.agent,
        model: message.model,
        ...(message.finish !== undefined ? { finish: message.finish } : {}),
        ...(message.error !== undefined ? { error: message.error } : {}),
      },
      parts: partsFromContent(message.content),
    }
  }

  if (type === "shell") {
    const output = isRecord(message.output) && typeof message.output.output === "string"
      ? message.output.output
      : typeof message.command === "string" ? message.command : ""
    return {
      info: { id, sessionID, role: "assistant" },
      parts: textPart(output),
    }
  }

  if (type === "compaction" && (message.status === "completed" || message.status === "running")) {
    return {
      info: { id, sessionID, role: "assistant" },
      parts: textPart(message.summary),
    }
  }

  if (type === "compaction") return undefined

  if (type === "user" || type === "synthetic" || type === "system" || type === "skill") {
    return {
      info: { id, sessionID, role: "user" },
      parts: textPart(message.text),
    }
  }

  return {
    info: { id, sessionID, role: "user" },
    parts: textPart(""),
  }
}

export function storedMessagesToV1(messages: unknown, sessionID: string): V1Message[] {
  if (!Array.isArray(messages)) return []
  const view: V1Message[] = []
  for (const message of messages) {
    if (!isRecord(message)) continue
    const translated = storedMessage(message, sessionID)
    if (translated) view.push(translated)
  }
  return view
}

export function hookMessagesToV1(messages: readonly unknown[], sessionID: string): V1Message[] {
  return messages.map((message) => {
    if (!isRecord(message)) {
      return { info: { sessionID, role: "user" }, parts: textPart("") }
    }
    if (typeof message.type === "string" && message.role === undefined) {
      return storedMessage(message, sessionID) ?? { info: { sessionID, role: "user" }, parts: textPart("") }
    }
    return {
      info: {
        id: message.id,
        sessionID,
        role: message.role,
        ...(message.agent !== undefined ? { agent: message.agent } : {}),
        ...(message.model !== undefined ? { model: message.model } : {}),
      },
      parts: Array.isArray(message.content) ? partsFromContent(message.content) : partsFromContent(message.parts),
    }
  })
}

export function writeHookMessagesBack<T>(original: readonly T[], edited: readonly V1Message[]): T[] {
  return edited.map((message, index) => {
    const current = original[index]
    const content = contentFromParts(message.parts)
    if (isRecord(current) && Array.isArray(current.content)) {
      current.content.splice(0, current.content.length, ...content)
      return current
    }
    return {
      ...(typeof message.info.id === "string" ? { id: message.info.id } : {}),
      role: message.info.role,
      content,
    } as T
  })
}

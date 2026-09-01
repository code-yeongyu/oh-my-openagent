import type { Message, Part } from "@opencode-ai/sdk"

export const BTW_PARENT_CONTEXT_MAX_BYTES = 64 * 1024
export const BTW_PARENT_CONTEXT_MAX_MESSAGES = 64

type MessageWithParts = {
  info: Message
  parts: Part[]
}

const encoder = new TextEncoder()

function serializedBytes(messages: MessageWithParts[]): number {
  return encoder.encode(JSON.stringify(messages)).byteLength
}

function cloneMessage(message: MessageWithParts): MessageWithParts {
  return {
    info: { ...message.info },
    parts: message.parts.map((part) => ({ ...part })),
  }
}

function boundedString(value: unknown, maxCharacters = 512): string {
  return typeof value === "string"
    ? value.slice(0, maxCharacters)
    : ""
}

function minimalMessageInfo(info: Message): Message {
  const source = info as unknown as Record<string, unknown>
  const minimal: Record<string, unknown> = {
    id: boundedString(source["id"], 256),
    sessionID: boundedString(source["sessionID"], 256),
    role: boundedString(source["role"], 32),
  }
  const time = source["time"]
  if (time && typeof time === "object" && !Array.isArray(time)) {
    const sourceTime = time as Record<string, unknown>
    minimal["time"] = {
      ...(typeof sourceTime["created"] === "number"
        ? { created: sourceTime["created"] }
        : {}),
      ...(typeof sourceTime["completed"] === "number"
        ? { completed: sourceTime["completed"] }
        : {}),
    }
  }
  for (const key of [
    "agent",
    "modelID",
    "providerID",
    "parentID",
    "mode",
    "path",
  ]) {
    if (typeof source[key] === "string") {
      minimal[key] = boundedString(source[key])
    }
  }
  const model = source["model"]
  if (model && typeof model === "object" && !Array.isArray(model)) {
    const sourceModel = model as Record<string, unknown>
    minimal["model"] = {
      providerID: boundedString(sourceModel["providerID"]),
      modelID: boundedString(sourceModel["modelID"]),
    }
  }
  return minimal as unknown as Message
}

function truncatedMessage(
  message: MessageWithParts,
  maxBytes: number,
): MessageWithParts {
  const sourceText = message.parts
    .filter((part) => part.type === "text")
    .map((part) => part.text)
    .join("\n")
  const marker = "[Earlier parent message content truncated]\n"
  const info = minimalMessageInfo(message.info)
  const createCandidate = (tailCharacters: number): MessageWithParts => ({
    info,
    parts: [
      {
        id: `${info.id}_btw_truncated`,
        messageID: info.id,
        sessionID: info.sessionID,
        type: "text",
        text: `${marker}${sourceText.slice(-tailCharacters)}`,
        synthetic: true,
      },
    ],
  })

  let best: MessageWithParts = {
    info,
    parts: [],
  }
  let low = 0
  let high = sourceText.length
  while (low <= high) {
    const middle = Math.floor((low + high) / 2)
    const candidate = createCandidate(middle)
    if (serializedBytes([candidate]) <= maxBytes) {
      best = candidate
      low = middle + 1
    } else {
      high = middle - 1
    }
  }
  return best
}

export function boundBtwParentContext(
  messages: MessageWithParts[],
): MessageWithParts[] {
  const candidates = messages.slice(-BTW_PARENT_CONTEXT_MAX_MESSAGES)
  const bounded: MessageWithParts[] = []

  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const message = cloneMessage(candidates[index])
    if (
      serializedBytes([message, ...bounded]) <=
      BTW_PARENT_CONTEXT_MAX_BYTES
    ) {
      bounded.unshift(message)
      continue
    }
    if (bounded.length === 0) {
      bounded.unshift(
        truncatedMessage(message, BTW_PARENT_CONTEXT_MAX_BYTES),
      )
    }
    break
  }

  return bounded
}

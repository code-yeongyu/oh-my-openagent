type TextPart = {
  type?: string
  text?: string
}

type MessageInfo = {
  id?: string
  role?: string
  error?: unknown
  model?: {
    providerID?: string
    modelID?: string
  }
  providerID?: string
  modelID?: string
}

export type SessionMessage = {
  info?: MessageInfo
  parts?: TextPart[]
}

export function getLastAssistantMessage(messages: SessionMessage[]): SessionMessage | null {
  for (let index = messages.length - 1; index >= 0; index--) {
    if (messages[index].info?.role === "assistant") {
      return messages[index]
    }
  }

  return null
}

export function extractAssistantText(message: SessionMessage): string {
  return (message.parts ?? [])
    .filter((part) => part.type === "text" && typeof part.text === "string")
    .map((part) => part.text?.trim() ?? "")
    .filter(Boolean)
    .join("\n")
}

export function isGptAssistantMessage(message: SessionMessage): boolean {
  const modelID = message.info?.model?.modelID ?? message.info?.modelID
  return typeof modelID === "string" && modelID.toLowerCase().includes("gpt")
}

export type AmbiguityReason =
  | "short-prompt"
  | "missing-goal"
  | "missing-scope"
  | "vague-requirements"
  | "multiple-interpretations"

export type AmbiguityResult = {
  ambiguous: boolean
  reasons: AmbiguityReason[]
}

export type ChatMessageInput = {
  sessionID: string
  agent?: string
  model?: { providerID: string; modelID: string }
  messageID?: string
}

export type MessagePart = {
  type: string
  text?: string
  [key: string]: unknown
}

export type ChatMessageOutput = {
  message: Record<string, unknown>
  parts: MessagePart[]
}

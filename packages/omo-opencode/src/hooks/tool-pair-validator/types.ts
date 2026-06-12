import type { Message, Part } from "@opencode-ai/sdk"

export type ToolUsePart = {
  type: "tool_use"
  id: string
  [key: string]: unknown
}

export type ToolResultPart = {
  type: "tool_result"
  toolUseId: string
  tool_use_id?: string
  isError?: boolean
  content: Array<{ type: "text"; text: string }>
  [key: string]: unknown
}

export type TextPart = {
  type: "text"
  text: string
  synthetic: true
}

export type TransformPart = Part | ToolUsePart | ToolResultPart | TextPart

export type TransformMessageInfo = Message | {
  role: "user"
  sessionID?: string
}

export interface MessageWithParts {
  info: TransformMessageInfo
  parts: TransformPart[]
}

export type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

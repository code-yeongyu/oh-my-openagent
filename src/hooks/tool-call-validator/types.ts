import type { Message, Part } from "@opencode-ai/sdk"

export interface MessageWithParts {
  info: Message
  parts: Part[]
}

export type ToolUsePart = Part & {
  type: "tool_use" | "tool"
  id: string
  name?: string
  tool?: string
  input?: Record<string, unknown>
}

export type ToolResultPart = Part & {
  type: "tool_result"
  id?: string
  tool_use_id?: string
  content?: unknown
}

export type TextPart = Part & {
  type: "text"
  id?: string
  text: string
  synthetic?: boolean
}

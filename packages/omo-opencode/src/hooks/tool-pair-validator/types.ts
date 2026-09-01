import type { Message, Part } from "@opencode-ai/sdk"

export type TransformPart = Part

export type TransformMessageInfo = Message | {
  role: "user"
  sessionID?: string
}

export interface MessageWithParts {
  info: TransformMessageInfo
  parts: TransformPart[]
}

export type UnpairedToolPart = {
  readonly callID: string
  readonly status: string
}

export type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

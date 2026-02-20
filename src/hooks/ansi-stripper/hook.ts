import type { Message, Part } from "@opencode-ai/sdk"

import { stripAnsi } from "./strip-ansi"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

interface SDKToolPart {
  type: string
  state?: {
    output?: string
    error?: string
    [key: string]: unknown
  }
  [key: string]: unknown
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] },
  ) => Promise<void>
}

function stripToolPartAnsi(part: SDKToolPart): void {
  if (!part.state) return

  if (typeof part.state.output === "string") {
    part.state.output = stripAnsi(part.state.output)
  }
  if (typeof part.state.error === "string") {
    part.state.error = stripAnsi(part.state.error)
  }
}

export function createAnsiStripperHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      if (!messages || messages.length === 0) return

      for (const msg of messages) {
        if (!msg.parts) continue

        for (const part of msg.parts) {
          const type = part.type as string
          if (type === "tool" || type === "tool_use") {
            stripToolPartAnsi(part as unknown as SDKToolPart)
          }
        }
      }
    },
  }
}

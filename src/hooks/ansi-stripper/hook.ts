import type { Message, Part, ToolPart } from "@opencode-ai/sdk"

import { stripAnsi } from "./strip-ansi"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] },
  ) => Promise<void>
}

function stripToolPartAnsi(part: ToolPart): void {
  if (part.state.status === "completed") {
    part.state.output = stripAnsi(part.state.output)
  } else if (part.state.status === "error") {
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
          if (part.type === "tool") {
            stripToolPartAnsi(part)
          }
        }
      }
    },
  }
}

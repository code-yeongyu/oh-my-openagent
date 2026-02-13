import type { Message, Part } from "@opencode-ai/sdk"

import { log } from "../../shared/logger"

interface MessageWithParts {
  info: Message
  parts: Part[]
}

type MessagesTransformHook = {
  "experimental.chat.messages.transform"?: (
    input: Record<string, never>,
    output: { messages: MessageWithParts[] }
  ) => Promise<void>
}

export function createTrailingAssistantGuardHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      const { messages } = output
      if (!messages || messages.length < 2) return

      let removed = 0
      while (
        messages.length > 1 &&
        messages[messages.length - 1].info.role === "assistant"
      ) {
        messages.pop()
        removed++
      }

      if (removed > 0) {
        log(
          `[trailing-assistant-guard] Removed ${removed} trailing assistant message(s) to prevent prefill error`,
        )
      }
    },
  }
}

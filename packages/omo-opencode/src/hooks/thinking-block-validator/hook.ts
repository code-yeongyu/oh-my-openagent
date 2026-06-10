import type { Message, Part } from "@opencode-ai/sdk"

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

export function createThinkingBlockValidatorHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async () => {
      return
    },
  }
}

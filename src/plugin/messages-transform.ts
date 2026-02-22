import type { Message, Part } from "@opencode-ai/sdk"

import type { CreatedHooks } from "../create-hooks"
import { deepSanitizeSurrogates } from "../shared/sanitize-surrogates"

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type MessagesTransformOutput = { messages: MessageWithParts[] }

export function createMessagesTransformHandler(args: {
  hooks: CreatedHooks
}): (input: Record<string, never>, output: MessagesTransformOutput) => Promise<void> {
  return async (input, output): Promise<void> => {
    const sanitizedBefore = deepSanitizeSurrogates(output.messages) as MessageWithParts[]
    output.messages.splice(0, output.messages.length, ...sanitizedBefore)

    await args.hooks.contextInjectorMessagesTransform?.[
      "experimental.chat.messages.transform"
    ]?.(input, output)

    await args.hooks.thinkingBlockValidator?.[
      "experimental.chat.messages.transform"
    ]?.(input, output)

    const sanitizedAfter = deepSanitizeSurrogates(output.messages) as MessageWithParts[]
    output.messages.splice(0, output.messages.length, ...sanitizedAfter)
  }
}

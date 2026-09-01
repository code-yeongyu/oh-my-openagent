import { validateToolPairsForMessages } from "./message-transform"
import type { MessagesTransformHook } from "./types"

export function createToolPairValidatorHook(): MessagesTransformHook {
  return {
    "experimental.chat.messages.transform": async (_input, output) => {
      validateToolPairsForMessages(output.messages)
    },
  }
}

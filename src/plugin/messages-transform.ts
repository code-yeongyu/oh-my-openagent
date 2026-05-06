import type { Message, Part } from "@opencode-ai/sdk"

import { log } from "../shared/logger"
import type { CreatedHooks } from "../create-hooks"

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type MessagesTransformOutput = { messages: MessageWithParts[] }

async function runMessagesTransformHookSafely<I, O>(
  hookName: string,
  handler: ((input: I, output: O) => unknown | Promise<unknown>) | null | undefined,
  input: I,
  output: O,
): Promise<void> {
  if (!handler) return
  try {
    await Promise.resolve(handler(input, output))
  } catch (error) {
    // Isolate per-handler failures so later handlers (notably toolPairValidator)
    // always run. A throw here used to leave orphaned tool_use blocks in the
    // post-compaction payload, producing API 400s like
    // "tool_use ids were found without tool_result blocks immediately after".
    log("[messages-transform] hook execution failed", {
      hook: hookName,
      error,
    })
  }
}

export function createMessagesTransformHandler(args: {
  hooks: CreatedHooks
}): (input: Record<string, never>, output: MessagesTransformOutput) => Promise<void> {
  return async (input, output): Promise<void> => {
    await runMessagesTransformHookSafely(
      "contextInjectorMessagesTransform",
      args.hooks.contextInjectorMessagesTransform?.[
        "experimental.chat.messages.transform"
      ],
      input,
      output,
    )

    await runMessagesTransformHookSafely(
      "teamModeStatusInjector",
      args.hooks.teamModeStatusInjector?.[
        "experimental.chat.messages.transform"
      ],
      input,
      output,
    )

    await runMessagesTransformHookSafely(
      "teamMailboxInjector",
      args.hooks.teamMailboxInjector?.[
        "experimental.chat.messages.transform"
      ],
      input,
      output,
    )

    await runMessagesTransformHookSafely(
      "thinkingBlockValidator",
      args.hooks.thinkingBlockValidator?.[
        "experimental.chat.messages.transform"
      ],
      input,
      output,
    )

    await runMessagesTransformHookSafely(
      "toolPairValidator",
      args.hooks.toolPairValidator?.[
        "experimental.chat.messages.transform"
      ],
      input,
      output,
    )
  }
}

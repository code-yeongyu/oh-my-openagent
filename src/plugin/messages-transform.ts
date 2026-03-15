import type { Message, Part } from "@opencode-ai/sdk"

import type { CreatedHooks } from "../create-hooks"
import { sanitizeSurrogates } from "../shared/sanitize-surrogates"

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type MessagesTransformOutput = { messages: MessageWithParts[] }

function sanitizeStringFields<T>(value: T): T {
  if (typeof value === "string") {
    return sanitizeSurrogates(value) as T
  }

  if (Array.isArray(value)) {
    return value.map((item) => sanitizeStringFields(item)) as T
  }

  if (!value || typeof value !== "object") {
    return value
  }

  const record = value as Record<string, unknown>
  const sanitizedEntries = Object.entries(record).map(([key, entryValue]) => [key, sanitizeStringFields(entryValue)])
  return Object.fromEntries(sanitizedEntries) as T
}

export function createMessagesTransformHandler(args: {
  hooks: CreatedHooks
}): (input: Record<string, never>, output: MessagesTransformOutput) => Promise<void> {
  return async (input, output): Promise<void> => {
    const sanitizedMessages = output.messages.map((message) => sanitizeStringFields(message))
    output.messages.splice(0, output.messages.length, ...sanitizedMessages)

    await args.hooks.contextInjectorMessagesTransform?.[
      "experimental.chat.messages.transform"
    ]?.(input, output)

    await args.hooks.thinkingBlockValidator?.[
      "experimental.chat.messages.transform"
    ]?.(input, output)

    const postHookSanitizedMessages = output.messages.map((message) => sanitizeStringFields(message))
    output.messages.splice(0, output.messages.length, ...postHookSanitizedMessages)
  }
}

import type { Message, Part } from "@opencode-ai/sdk"

import type { CreatedHooks } from "../create-hooks"

type MessageWithParts = {
  info: Message
  parts: Part[]
}

type MessagesTransformOutput = { messages: MessageWithParts[] }

const MESSAGES_TRANSFORM_CACHE_MAX = 100
const messagesTransformCache = new Map<string, MessageWithParts[]>()
const messageHashCache = new WeakMap<MessageWithParts[], string>()

function hashMessages(messages: MessageWithParts[]): string {
  const cached = messageHashCache.get(messages)
  if (cached !== undefined) return cached
  const fresh = JSON.stringify(messages)
  messageHashCache.set(messages, fresh)
  return fresh
}

function extractSessionID(messages: MessageWithParts[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i--) {
    const id = messages[i].info.sessionID
    if (id) return id
  }
  return undefined
}

function getCachedTransform(
  sessionID: string,
  messagesHash: string
): MessageWithParts[] | undefined {
  const key = `${sessionID}:${messagesHash}`
  const cached = messagesTransformCache.get(key)
  if (cached === undefined) return undefined
  messagesTransformCache.delete(key)
  messagesTransformCache.set(key, cached)
  return cached
}

function setCachedTransform(
  sessionID: string,
  messagesHash: string,
  messages: MessageWithParts[]
): void {
  const key = `${sessionID}:${messagesHash}`
  if (messagesTransformCache.size >= MESSAGES_TRANSFORM_CACHE_MAX) {
    const oldest = messagesTransformCache.keys().next().value
    if (oldest !== undefined) messagesTransformCache.delete(oldest)
  }
  messagesTransformCache.set(key, messages)
}

export function _resetMessagesTransformCacheForTesting(): void {
  messagesTransformCache.clear()
}

export function createMessagesTransformHandler(args: {
  hooks: CreatedHooks
}): (input: Record<string, never>, output: MessagesTransformOutput) => Promise<void> {
  return async (input, output): Promise<void> => {
    const sessionID = extractSessionID(output.messages)
    if (!sessionID) {
      await args.hooks.contextInjectorMessagesTransform?.[
        "experimental.chat.messages.transform"
      ]?.(input, output)

      await args.hooks.thinkingBlockValidator?.[
        "experimental.chat.messages.transform"
      ]?.(input, output)
      return
    }

    const messagesHash = hashMessages(output.messages)
    const cached = getCachedTransform(sessionID, messagesHash)
    if (cached !== undefined) return

    await args.hooks.contextInjectorMessagesTransform?.[
      "experimental.chat.messages.transform"
    ]?.(input, output)

    await args.hooks.thinkingBlockValidator?.[
      "experimental.chat.messages.transform"
    ]?.(input, output)

    setCachedTransform(sessionID, messagesHash, output.messages)
  }
}

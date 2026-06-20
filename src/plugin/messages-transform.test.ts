import { afterEach, describe, expect, mock, test } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk"

import {
  _resetMessagesTransformCacheForTesting,
  createMessagesTransformHandler,
} from "./messages-transform"

type MessageWithParts = { info: Message; parts: Part[] }

function makeMessage(role: "user" | "assistant", sessionID: string, id: string): MessageWithParts {
  return {
    info: {
      id,
      sessionID,
      role,
      time: { created: 0 },
    } as Message,
    parts: [],
  }
}

describe("createMessagesTransformHandler — T3.25 idempotency", () => {
  afterEach(() => {
    _resetMessagesTransformCacheForTesting()
  })

  test("messages.transform idempotent on (sessionID, messagesHash)", async () => {
    //#given
    let callCount = 0
    const contextInjectorHook = mock(async () => {
      callCount++
    })
    const thinkingBlockValidatorHook = mock(async () => {
      callCount++
    })

    const handler = createMessagesTransformHandler({
      hooks: {
        contextInjectorMessagesTransform: {
          "experimental.chat.messages.transform": contextInjectorHook,
        },
        thinkingBlockValidator: {
          "experimental.chat.messages.transform": thinkingBlockValidatorHook,
        },
      },
    } as Parameters<typeof createMessagesTransformHandler>[0]["hooks"])

    const messages: MessageWithParts[] = [makeMessage("user", "ses_abc", "msg_1")]
    const input = {} as Record<string, never>
    const output = { messages }

    //#when
    await handler(input, output)
    const callsAfterFirst = callCount
    await handler(input, output)
    const callsAfterSecond = callCount

    //#then
    expect(callsAfterFirst).toBe(2)
    expect(callsAfterSecond).toBe(2)
    expect(contextInjectorHook).toHaveBeenCalledTimes(1)
    expect(thinkingBlockValidatorHook).toHaveBeenCalledTimes(1)
  })
})

import { describe, expect, it } from "bun:test"
import type { Message, Part } from "@opencode-ai/sdk"

import {
  appendVolatileTailMessage,
  stripVolatileTail,
  VOLATILE_TAIL_METADATA_KEY,
  type VolatileTailMessage,
} from "./volatile-tail"

function textPart(text: string): Part {
  return {
    id: `part_${text}`,
    messageID: `msg_${text}`,
    sessionID: "ses_volatile_tail",
    type: "text",
    text,
  } as Part
}

function userMessage(id: string, text: string): VolatileTailMessage {
  return {
    info: {
      id,
      sessionID: "ses_volatile_tail",
      role: "user",
      time: { created: 1 },
    } as Message,
    parts: [textPart(text)],
  }
}

describe("volatile-tail", () => {
  describe("#given a payload with a stable prefix and a volatile tail #when stripping #then only the tail is removed", () => {
    it("removes trailing tagged messages and keeps the prefix bytes intact", () => {
      // given
      const prefixFirst = userMessage("msg_1", "stable one")
      const prefixSecond = userMessage("msg_2", "stable two")
      const messages: VolatileTailMessage[] = [prefixFirst, prefixSecond]
      appendVolatileTailMessage(messages, userMessage("msg_tail", "churn"))

      // when
      const removed = stripVolatileTail(messages)

      // then
      expect(removed).toBe(1)
      expect(messages.length).toBe(2)
      expect(messages[0]?.info.id).toBe("msg_1")
      expect(messages[1]?.info.id).toBe("msg_2")
      expect(messages[0]?.parts[0]).toEqual(prefixFirst.parts[0])
      expect(messages[1]?.parts[0]).toEqual(prefixSecond.parts[0])
    })

    it("stops at the first untagged message so mid-payload tags survive", () => {
      // given
      const messages: VolatileTailMessage[] = [userMessage("msg_1", "stable")]
      appendVolatileTailMessage(messages, userMessage("msg_mid", "volatile mid"))
      messages.push(userMessage("msg_3", "stable again"))

      // when
      const removed = stripVolatileTail(messages)

      // then
      expect(removed).toBe(0)
      expect(messages.length).toBe(3)
      expect(messages[1]?.info.id).toBe("msg_mid")
    })

    it("leaves an untagged payload untouched", () => {
      // given
      const messages: VolatileTailMessage[] = [userMessage("msg_1", "stable")]

      // when
      const removed = stripVolatileTail(messages)

      // then
      expect(removed).toBe(0)
      expect(messages.length).toBe(1)
    })
  })

  describe("#given a volatile injector that fires twice #when appending again #then the tail is replaced not duplicated", () => {
    it("re-invocation replaces the previous tail message", () => {
      // given
      const messages: VolatileTailMessage[] = [userMessage("msg_1", "stable")]
      appendVolatileTailMessage(messages, userMessage("msg_tail", "first churn"))

      // when
      appendVolatileTailMessage(messages, userMessage("msg_tail", "second churn"))

      // then
      expect(messages.length).toBe(2)
      const tailParts = messages[1]?.parts.filter(
        (part) =>
          typeof part === "object" &&
          part !== null &&
          (part as { metadata?: unknown }).metadata !== undefined &&
          typeof (part as { metadata?: Record<string, unknown> }).metadata ===
            "object" &&
          (
            (part as { metadata?: Record<string, unknown> }).metadata as Record<
              string,
              unknown
            >
          )[VOLATILE_TAIL_METADATA_KEY] === true,
      )
      expect(tailParts?.length).toBe(1)
      const text = tailParts?.[0] as { text?: string }
      expect(text.text).toBe("second churn")
    })

    it("appends a single tagged message on first injection", () => {
      // given
      const messages: VolatileTailMessage[] = [userMessage("msg_1", "stable")]

      // when
      appendVolatileTailMessage(messages, userMessage("msg_tail", "churn"))

      // then
      expect(messages.length).toBe(2)
      expect(messages[1]?.info.id).toBe("msg_tail")
      const removed = stripVolatileTail(messages)
      expect(removed).toBe(1)
      expect(messages.length).toBe(1)
    })
  })
})

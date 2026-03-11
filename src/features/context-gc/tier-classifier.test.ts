import { describe, it, expect, beforeEach } from "bun:test"
import type { GcMessageInfo, GcPart, MessageWithParts } from "./types"
import { classifyMessages } from "./tier-classifier"

function createAssistantMessage(id: string, text: string): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "ses_1",
      role: "assistant",
    } as GcMessageInfo,
    parts: [{ type: "text", text }] as GcPart[],
  }
}

function createUserMessage(id: string, text: string): MessageWithParts {
  return {
    info: {
      id,
      sessionID: "ses_1",
      role: "user",
    } as GcMessageInfo,
    parts: [{ type: "text", text }] as GcPart[],
  }
}

describe("tier-classifier", () => {
  beforeEach(() => {})

  describe("#given assistant-only histories", () => {
    describe("#when classifying exactly 5 assistant messages with default config", () => {
      it("#then last 3 messages should be hot (hot turns = 3)", () => {
        const messages = Array.from({ length: 5 }, (_, i) => createAssistantMessage(`msg_${i + 1}`, `response ${i + 1}`))

        const results = classifyMessages(messages, undefined)

        expect(results).toHaveLength(5)
        expect(results.filter((entry) => entry.tier === "hot")).toHaveLength(3)
        const hotResults = results.filter((entry) => entry.tier === "hot")
        expect(hotResults[0]?.turnAge).toBe(0)
        expect(hotResults[1]?.turnAge).toBe(1)
        expect(hotResults[2]?.turnAge).toBe(2)
      })
    })

    describe("#when classifying more than warm threshold", () => {
      it("#then messages older than 3 turns should be warm and older than 10 should be cold", () => {
        const messages = Array.from({ length: 22 }, (_, i) => createAssistantMessage(`msg_${i + 1}`, `response ${i + 1}`))

        const results = classifyMessages(messages, undefined)

        expect(results.filter((entry) => entry.turnAge < 3).every((entry) => entry.tier === "hot")).toBe(true)
        expect(results.filter((entry) => entry.turnAge >= 3 && entry.turnAge < 10).every((entry) => entry.tier === "warm")).toBe(true)
        expect(results.filter((entry) => entry.turnAge >= 10).every((entry) => entry.tier === "cold")).toBe(true)
      })
    })

    describe("#when using custom turn thresholds", () => {
      it("#then config hot_turns and warm_turns should override defaults", () => {
        const messages = Array.from({ length: 12 }, (_, i) => createAssistantMessage(`msg_${i + 1}`, `response ${i + 1}`))

        const results = classifyMessages(messages, {
          hot_turns: 3,
          warm_turns: 10,
        } as never)

        expect(results.filter((entry) => entry.turnAge < 3).every((entry) => entry.tier === "hot")).toBe(true)
        expect(results.filter((entry) => entry.turnAge >= 3 && entry.turnAge < 10).every((entry) => entry.tier === "warm")).toBe(true)
        expect(results.filter((entry) => entry.turnAge >= 10).every((entry) => entry.tier === "cold")).toBe(true)
      })
    })

    describe("#when min_hot_turns is configured", () => {
      it("#then hot count respects min_hot_turns default (3)", () => {
        const messages = Array.from({ length: 6 }, (_, i) => createAssistantMessage(`msg_${i + 1}`, "hello"))

        const results = classifyMessages(messages, undefined)
        const hotCount = results.filter((entry) => entry.tier === "hot").length

        expect(hotCount).toBe(3)
        expect(results.filter((entry) => entry.tier === "hot").every((entry) => entry.turnAge < 3)).toBe(true)
        expect(results.some((entry) => entry.tier === "warm")).toBe(true)
      })

      it("#then min_hot_turns config overrides the default floor", () => {
        const messages = Array.from({ length: 10 }, (_, i) => createAssistantMessage(`msg_${i + 1}`, "hello"))

        const results = classifyMessages(messages, { min_hot_turns: 5 } as never)
        const hotCount = results.filter((entry) => entry.tier === "hot").length

        expect(hotCount).toBe(5)
        expect(results.filter((entry) => entry.tier === "hot").every((entry) => entry.turnAge < 5)).toBe(true)
      })

      it("#then hot floor of 1 can be set via config for aggressive mode", () => {
        const messages = Array.from({ length: 6 }, (_, i) => createAssistantMessage(`msg_${i + 1}`, "hello"))

        const results = classifyMessages(messages, { min_hot_turns: 1, hot_turns: 1 } as never)
        const hotCount = results.filter((entry) => entry.tier === "hot").length

        expect(hotCount).toBe(1)
        expect(results.find((entry) => entry.tier === "hot")?.turnAge).toBe(0)
      })
    })
  })

  describe("#given mixed user and assistant turns", () => {
    describe("#when classifying user messages", () => {
      it("#then user messages should follow their paired assistant turn age", () => {
        const messages = [
          createUserMessage("msg_1", "u1"),
          createAssistantMessage("msg_2", "a1"),
          createUserMessage("msg_3", "u2"),
          createAssistantMessage("msg_4", "a2"),
        ]

        const results = classifyMessages(messages, undefined)

        expect(results[0]?.turnAge).toBe(results[1]?.turnAge)
        expect(results[2]?.turnAge).toBe(results[3]?.turnAge)
      })
    })
  })

  describe("#given no messages", () => {
    describe("#when classifyMessages is called", () => {
      it("#then it should return an empty list", () => {
        expect(classifyMessages([], undefined)).toEqual([])
      })
    })
  })
})

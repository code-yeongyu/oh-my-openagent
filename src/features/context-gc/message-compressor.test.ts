import { describe, it, expect, beforeEach } from "bun:test"
import type { GcMessageInfo, GcPart, MessageWithParts } from "./types"
import type { TierClassification } from "./tier-classifier"
import { compressMessages } from "./message-compressor"

function createMessage(input: {
  id: string
  sessionID?: string
  role: "assistant" | "user"
  parts: Array<Record<string, unknown>>
}): MessageWithParts {
  return {
    info: {
      id: input.id,
      sessionID: input.sessionID ?? "ses_1",
      role: input.role,
    } as GcMessageInfo,
    parts: input.parts as GcPart[],
  }
}

function classification(messageIndex: number, tier: TierClassification["tier"]): TierClassification {
  return {
    messageIndex,
    tier,
    turnAge: 0,
    estimatedTokens: 0,
  }
}

describe("message-compressor", () => {
  beforeEach(() => {})

  describe("#given hot-tier messages", () => {
    describe("#when compressMessages is called", () => {
      it("#then hot messages should remain untouched", () => {
        const messages = [
          createMessage({
            id: "msg_hot",
            role: "assistant",
            parts: [
              { type: "text", text: "keep this" },
              { type: "thinking", text: "internal" },
              { type: "tool", tool: "bash", state: { status: "completed", output: "line1\nline2\nline3" } },
            ],
          }),
        ]

        const stats = compressMessages(messages, [classification(0, "hot")], undefined, Infinity)

        const toolOutput = (messages[0]?.parts[2] as unknown as { state?: { output?: string } }).state?.output
        expect(toolOutput).toBe("line1\nline2\nline3")
        expect(messages[0]?.parts).toHaveLength(3)
        expect(stats).toEqual({
          toolOutputsCompressed: 0,
          thinkingBlocksRemoved: 0,
          textPartsCompressed: 0,
          systemPartsRemoved: 0,
          messagesRemoved: 0,
        })
      })
    })
  })

  describe("#given warm-tier assistant messages", () => {
    describe("#when compressMessages is called", () => {
      it("#then tool outputs should be compressed while text parts are kept", () => {
        const messages = [
          createMessage({
            id: "msg_warm",
            role: "assistant",
            parts: [
              { type: "text", text: "retain this text" },
              {
                type: "tool",
                callID: "call_1",
                tool: "bash",
                state: { status: "completed", output: "ok\nFAIL happened\nnext\nlast" },
              },
            ],
          }),
        ]

        const stats = compressMessages(messages, [classification(0, "warm")], undefined, Infinity)
        const textPart = messages[0]?.parts[0] as unknown as { text?: string }
        const toolPart = messages[0]?.parts[1] as unknown as { state?: { output?: string } }

        expect(textPart.text).toBe("retain this text")
        expect(toolPart.state?.output).toContain("FAIL happened")
        expect(toolPart.state?.output).toContain("... [3 more lines]")
        expect(stats.toolOutputsCompressed).toBe(1)
        expect(stats.thinkingBlocksRemoved).toBe(0)
      })
    })
  })

  describe("#given cold-tier assistant messages", () => {
    describe("#when compressMessages is called", () => {
      it("#then tool outputs should be compressed and thinking parts removed", () => {
        const messages = [
          createMessage({
            id: "msg_cold",
            role: "assistant",
            parts: [
              { type: "tool", tool: "grep", state: { status: "completed", output: "x".repeat(300) } },
              { type: "thinking", text: "remove me" },
              { type: "text", text: "visible short text" },
            ],
          }),
        ]

        const stats = compressMessages(messages, [classification(0, "cold")], undefined, Infinity)
        const partTypes = messages[0]?.parts.map((part) => (part as unknown as { type: string }).type)
        const toolPart = messages[0]?.parts[0] as unknown as { state?: { output?: string } }

        expect(partTypes).toEqual(["tool", "text"])
        expect(toolPart.state?.output).toContain("[compressed:")
        expect(stats.toolOutputsCompressed).toBe(1)
        expect(stats.thinkingBlocksRemoved).toBe(1)
      })
    })
  })

  describe("#given a mix of warm and cold assistant/user messages", () => {
    describe("#when compressMessages processes all eligible messages", () => {
      it("#then stats should count each compression category accurately", () => {
        const messages = [
          createMessage({
            id: "msg_1",
            role: "assistant",
            parts: [{ type: "tool", tool: "bash", state: { status: "completed", output: "FAIL warm\nline2" } }],
          }),
          createMessage({
            id: "msg_2",
            role: "assistant",
            parts: [
              { type: "tool", tool: "grep", state: { status: "completed", output: "x".repeat(500) } },
              { type: "thinking", text: "remove me" },
              { type: "text", text: "b".repeat(500) },
            ],
          }),
          createMessage({
            id: "msg_3",
            role: "user",
            parts: [
              { type: "tool", tool: "webfetch", state: { status: "completed", output: "x".repeat(500) } },
              { type: "text", text: "c".repeat(1000), synthetic: true },
            ],
          }),
        ]

        const classifications: TierClassification[] = [
          classification(0, "warm"),
          classification(1, "cold"),
          classification(2, "cold"),
        ]

        const stats = compressMessages(messages, classifications, undefined, Infinity)

        expect(stats).toEqual({
          toolOutputsCompressed: 3,
          thinkingBlocksRemoved: 1,
          textPartsCompressed: 1,
          systemPartsRemoved: 1,
          messagesRemoved: 0,
        })
      })
    })
  })

  describe("#given gone-tier messages", () => {
    describe("#when compressMessages is called", () => {
      it("#then gone messages should be removed from the array", () => {
        const messages = [
          createMessage({
            id: "msg_1",
            role: "assistant",
            parts: [{ type: "text", text: "should be removed" }],
          }),
          createMessage({
            id: "msg_2",
            role: "user",
            parts: [{ type: "text", text: "user message" }],
          }),
          createMessage({
            id: "msg_3",
            role: "assistant",
            parts: [{ type: "text", text: "should stay" }],
          }),
        ]

        const classifications: TierClassification[] = [
          classification(0, "gone"),
          classification(1, "gone"),
          classification(2, "hot"),
        ]

        const stats = compressMessages(messages, classifications, undefined, Infinity)

        expect(messages).toHaveLength(1)
        expect(messages[0]?.info.id).toBe("msg_3")
        expect(stats.messagesRemoved).toBe(2)
      })
    })
  })

  describe("#given gone-tier removals that would expose trailing assistant", () => {
    describe("#when the conversation originally ends with user", () => {
      it("#then should trim removals to avoid trailing assistant", () => {
        const messages = [
          createMessage({
            id: "msg_1",
            role: "assistant",
            parts: [{ type: "text", text: "old response" }],
          }),
          createMessage({
            id: "msg_2",
            role: "user",
            parts: [{ type: "text", text: "old prompt" }],
          }),
          createMessage({
            id: "msg_3",
            role: "assistant",
            parts: [{ type: "text", text: "another response" }],
          }),
          createMessage({
            id: "msg_4",
            role: "user",
            parts: [{ type: "text", text: "latest prompt" }],
          }),
        ]

        const classifications: TierClassification[] = [
          classification(0, "gone"),
          classification(1, "gone"),
          classification(2, "gone"),
          classification(3, "hot"),
        ]

        const stats = compressMessages(messages, classifications, undefined, Infinity)

        // msg_4 (user, hot) must survive as last message
        // Removing msg_2 + msg_3 would leave [assistant, user] — that's fine
        // But removing all 3 (0,1,2) leaves only msg_4 (user) — also fine
        // Key: conversation must NOT end with assistant
        const lastInfo = messages[messages.length - 1].info as unknown as { role?: string }
        expect(lastInfo.role).not.toBe("assistant")
        expect(stats.messagesRemoved).toBeGreaterThan(0)
      })
    })
  })
})

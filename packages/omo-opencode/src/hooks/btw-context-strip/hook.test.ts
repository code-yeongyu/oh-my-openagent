/// <reference path="../../../bun-test.d.ts" />

import { describe, expect, it } from "bun:test"

import { createBtwContextStripHook } from "./hook"
import {
  AUTO_SLASH_COMMAND_TAG_CLOSE,
  AUTO_SLASH_COMMAND_TAG_OPEN,
} from "../auto-slash-command/constants"
import {
  BTW_AUTO_SLASH_COMMAND_MARKER,
  type BtwMarkerPredicate,
} from "./predicates"
import {
  buildAssistantMessage,
  buildAssistantWithThinkingMessage,
  buildBtwPair,
  buildMultiPartAssistantMessage,
  buildToolUsePair,
  buildUserMessage,
  runStripTransform,
  type MessageWithParts,
} from "./test-fixtures"

const TEST_MARKER = "__BTW_TEST_MARKER__"
const SECRET = "PURPLE-PANDA-47"

const isMarked: BtwMarkerPredicate = (msg) => JSON.stringify(msg).includes(TEST_MARKER)

function runHook(messages: MessageWithParts[]): MessageWithParts[] {
  const hook = createBtwContextStripHook(isMarked)
  return runStripTransform(messages, ({ output }) => hook(undefined, output))
}

async function runHookAsync(messages: MessageWithParts[]): Promise<MessageWithParts[]> {
  const output = { messages: [...messages] }
  await createBtwContextStripHook(isMarked)(undefined, output)
  return output.messages
}

function payload(messages: unknown): string {
  return JSON.stringify(messages)
}

function textParts(message: MessageWithParts): string[] {
  return message.parts.flatMap((part) => {
    const candidate = part as { text?: unknown }
    return typeof candidate.text === "string" ? [candidate.text] : []
  })
}

describe("createBtwContextStripHook", () => {
  describe("#given a completed /btw pair before a later turn", () => {
    describe("#when the strip transform runs", () => {
      it("#then strips the pair so the secret is absent from the later-turn payload", () => {
        const opening = buildUserMessage("public opening")
        const pair = buildBtwPair(TEST_MARKER, SECRET)
        const followUp = buildUserMessage("continue publicly")
        const messages = [opening, pair.btwUser, pair.btwAnswer, followUp]

        const result = runHook(messages)

        expect(result).toEqual([opening, followUp])
        expect(payload(result)).not.toContain(TEST_MARKER)
        expect(payload(result)).not.toContain(SECRET)
      })
    })
  })

  describe("#given a pending /btw turn is the final message", () => {
    describe("#when the strip transform runs before the assistant answers", () => {
      it("#then keeps the pending turn", () => {
        const opening = buildUserMessage("public opening")
        const pending = buildBtwPair(TEST_MARKER, SECRET).btwUser
        const messages = [opening, pending]

        const result = runHook(messages)

        expect(result).toEqual(messages)
        expect(payload(result)).toContain(TEST_MARKER)
      })
    })
  })

  describe("#given two consecutive completed /btw pairs", () => {
    describe("#when the strip transform runs", () => {
      it("#then strips both pairs", () => {
        const first = buildBtwPair(TEST_MARKER, "FIRST-SECRET")
        const second = buildBtwPair(TEST_MARKER, "SECOND-SECRET")
        const publicFollowUp = buildUserMessage("back to public work")
        const messages = [first.btwUser, first.btwAnswer, second.btwUser, second.btwAnswer, publicFollowUp]

        const result = runHook(messages)

        expect(result).toEqual([publicFollowUp])
        expect(payload(result)).not.toContain(TEST_MARKER)
        expect(payload(result)).not.toContain("FIRST-SECRET")
        expect(payload(result)).not.toContain("SECOND-SECRET")
      })
    })
  })

  describe("#given a completed /btw pair with a multi-part assistant answer", () => {
    describe("#when the strip transform runs", () => {
      it("#then removes the full assistant answer", () => {
        const btwUser = buildBtwPair(TEST_MARKER, SECRET).btwUser
        const multiPartAnswer = buildMultiPartAssistantMessage([
          `private part one ${SECRET}`,
          "private part two",
        ])
        const publicFollowUp = buildUserMessage("public follow-up")

        const result = runHook([btwUser, multiPartAnswer, publicFollowUp])

        expect(result).toEqual([publicFollowUp])
        expect(payload(result)).not.toContain(SECRET)
      })
    })
  })

  describe("#given a completed /btw pair with a reasoning answer", () => {
    describe("#when the strip transform runs", () => {
      it("#then removes the reasoning and visible answer parts", () => {
        const btwUser = buildBtwPair(TEST_MARKER, SECRET).btwUser
        const thinkingAnswer = buildAssistantWithThinkingMessage(
          `private reasoning ${SECRET}`,
          "private visible answer",
        )
        const publicFollowUp = buildUserMessage("public follow-up")

        const result = runHook([btwUser, thinkingAnswer, publicFollowUp])

        expect(result).toEqual([publicFollowUp])
        expect(payload(result)).not.toContain(SECRET)
      })
    })
  })

  describe("#given malformed or empty output messages with no marker", () => {
    describe("#when the strip transform runs", () => {
      it("#then does not throw and leaves malformed marker-free messages unchanged", async () => {
        const malformedMessages: unknown[] = [null, { parts: "not-an-array" }, buildUserMessage("public only")]
        const output = { messages: malformedMessages as MessageWithParts[] }

        const result = await createBtwContextStripHook(isMarked)(undefined, output)

        expect(result).toBeUndefined()
        expect(output.messages).toEqual(malformedMessages)
      })

      it("#then does not throw when output.messages is not an array", async () => {
        const output = { messages: undefined } as unknown as { messages: MessageWithParts[] }

        const result = await createBtwContextStripHook(isMarked)(undefined, output)

        expect(result).toBeUndefined()
        expect(output.messages).toBeUndefined()
      })
    })
  })

  describe("#given a malformed but marked /btw message", () => {
    describe("#when the strip transform runs", () => {
      it("#then does not throw and strips the marked segment so the secret never leaks", async () => {
        const malformedMarked = {
          parts: [{ type: "text", text: `${TEST_MARKER} /btw ${SECRET}` }],
        }
        const malformedAnswer = {
          parts: [{ type: "text", text: `private malformed answer ${SECRET}` }],
        }
        const publicFollowUp = buildUserMessage("public follow-up")
        const output = {
          messages: [malformedMarked, malformedAnswer, publicFollowUp] as unknown as MessageWithParts[],
        }

        const result = await createBtwContextStripHook(isMarked)(undefined, output)

        expect(result).toBeUndefined()
        expect(output.messages).toEqual([publicFollowUp])
        expect(payload(output.messages)).not.toContain(TEST_MARKER)
        expect(payload(output.messages)).not.toContain(SECRET)
      })
    })
  })

  describe("#given the concrete /btw marker is detectable but the supplied predicate throws", () => {
    describe("#when the strip transform runs", () => {
      it("#then strips the detected segment instead of failing open", async () => {
        const throwingPredicate: BtwMarkerPredicate = () => {
          throw new Error("malformed shape")
        }
        const malformedMarked = {
          parts: [{
            type: "text",
            text: [
              AUTO_SLASH_COMMAND_TAG_OPEN,
              "# BTW Command",
              "",
              `**User Arguments**: ${SECRET}`,
              AUTO_SLASH_COMMAND_TAG_CLOSE,
            ].join("\n"),
            [BTW_AUTO_SLASH_COMMAND_MARKER]: true,
          }],
        }
        const malformedAnswer = {
          parts: [{ type: "text", text: `private malformed answer ${SECRET}` }],
        }
        const publicFollowUp = buildUserMessage("public follow-up")
        const output = {
          messages: [malformedMarked, malformedAnswer, publicFollowUp] as unknown as MessageWithParts[],
        }

        const result = await createBtwContextStripHook(throwingPredicate)(undefined, output)

        expect(result).toBeUndefined()
        expect(output.messages).toEqual([publicFollowUp])
        expect(payload(output.messages)).not.toContain(AUTO_SLASH_COMMAND_TAG_OPEN)
        expect(payload(output.messages)).not.toContain(SECRET)
      })
    })
  })

  describe("#given a /btw answer that used a tool despite the read-only guard", () => {
    describe("#when the strip transform runs", () => {
      it("#then strips the whole exchange including the tool pair so nothing leaks", () => {
        const opening = buildUserMessage("public opening")
        const btwUser = buildBtwPair(TEST_MARKER, SECRET).btwUser
        const pair = buildToolUsePair("fixture_tool", "toolu_fixture_1")
        const messages = [opening, btwUser, pair.toolUse, pair.toolResult]

        const result = runHook(messages)

        expect(result).toEqual([opening])
        expect(payload(result)).not.toContain(TEST_MARKER)
        expect(payload(result)).not.toContain("toolu_fixture_1")
      })

      it("#then strips the tool pair together with the turn when a later real user turn exists", () => {
        const opening = buildUserMessage("public opening")
        const btwUser = buildBtwPair(TEST_MARKER, SECRET).btwUser
        const pair = buildToolUsePair("fixture_tool", "toolu_fixture_2")
        const followUp = buildUserMessage("continue publicly")
        const messages = [opening, btwUser, pair.toolUse, pair.toolResult, followUp]

        const result = runHook(messages)

        expect(result).toEqual([opening, followUp])
        expect(payload(result)).not.toContain(TEST_MARKER)
        expect(payload(result)).not.toContain(SECRET)
        expect(payload(result)).not.toContain("toolu_fixture_2")
      })
    })
  })

  describe("#given normal messages surround a completed /btw pair", () => {
    describe("#when the strip transform runs", () => {
      it("#then preserves the surrounding messages in order", async () => {
        const beforeUser = buildUserMessage("first public question")
        const beforeAssistant = buildAssistantMessage("first public answer")
        const pair = buildBtwPair(TEST_MARKER, SECRET)
        const afterUser = buildUserMessage("second public question")
        const afterAssistant = buildAssistantMessage("second public answer")

        const result = await runHookAsync([
          beforeUser,
          beforeAssistant,
          pair.btwUser,
          pair.btwAnswer,
          afterUser,
          afterAssistant,
        ])

        expect(result).toEqual([beforeUser, beforeAssistant, afterUser, afterAssistant])
        expect(textParts(result[0] ?? beforeUser)).toEqual(["first public question"])
        expect(textParts(result[1] ?? beforeAssistant)).toEqual(["first public answer"])
        expect(textParts(result[2] ?? afterUser)).toEqual(["second public question"])
        expect(textParts(result[3] ?? afterAssistant)).toEqual(["second public answer"])
      })
    })
  })

  describe("#given OpenCode holds the original output.messages array reference", () => {
    describe("#when the strip transform removes a completed /btw pair", () => {
      it("#then mutates that same array in place so captured references observe the stripped payload", async () => {
        const opening = buildUserMessage("public opening")
        const pair = buildBtwPair(TEST_MARKER, SECRET)
        const followUp = buildUserMessage("continue publicly")
        const messages = [opening, pair.btwUser, pair.btwAnswer, followUp]
        const output = { messages }
        const capturedMessagesReference = output.messages

        await createBtwContextStripHook(isMarked)(undefined, output)

        expect(output.messages).toBe(capturedMessagesReference)
        expect(capturedMessagesReference).toEqual([opening, followUp])
        expect(payload(capturedMessagesReference)).not.toContain(TEST_MARKER)
        expect(payload(capturedMessagesReference)).not.toContain(SECRET)
      })
    })
  })

  describe("#given the main strip path throws after computing strip indices", () => {
    describe("#when the fail-closed fallback runs", () => {
      it("#then still strips the /btw answer so the private secret cannot leak", async () => {
        const opening = buildUserMessage("public opening")
        const pair = buildBtwPair(TEST_MARKER, SECRET)
        const followUp = buildUserMessage("continue publicly")
        const messages = [opening, pair.btwUser, pair.btwAnswer, followUp]
        let firstSpliceThrows = true
        Object.defineProperty(messages, "splice", {
          configurable: true,
          writable: true,
          value(...args: [number, number]) {
            if (firstSpliceThrows) {
              firstSpliceThrows = false
              throw new Error("forced main-path failure")
            }
            return Array.prototype.splice.apply(this, args)
          },
        })
        const output = { messages }

        await createBtwContextStripHook(isMarked)(undefined, output)

        expect(payload(output.messages)).not.toContain(SECRET)
        expect(payload(output.messages)).not.toContain(TEST_MARKER)
        expect(output.messages).toEqual([opening, followUp])
      })
    })
  })

  describe("#given computeFailClosedStripIndices itself throws (B3-v2 fallback)", () => {
    describe("#when the fail-closed fallback cannot compute trusted strip indices", () => {
      it("#then clears all messages when index computation fails in applyFailClosedStrip", async () => {
        const opening = buildUserMessage("public opening")
        Object.defineProperty(opening, "parts", {
          configurable: true,
          get() {
            throw new Error("forced index-computation failure")
          },
        })
        const messages = [opening, buildAssistantMessage(SECRET)]
        const neverMarked: BtwMarkerPredicate = () => false
        const output = { messages }

        await createBtwContextStripHook(neverMarked)(undefined, output)

        expect(output.messages).toHaveLength(0)
      })
    })
  })
})

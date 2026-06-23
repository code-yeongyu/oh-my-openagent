import { describe, expect, it } from "bun:test"

import {
  buildBtwPair,
  buildToolUsePair,
  buildUserMessage,
  runStripTransform,
} from "./test-fixtures"

describe("btw context strip test fixtures", () => {
  describe("#given a marked BTW pair", () => {
    describe("#when the pair is built", () => {
      it("#then carries the marker on the user message and secret on the answer", () => {
        const marker = "__BTW_MARKER__"
        const secret = "PURPLE-PANDA-47"
        const pair = buildBtwPair(marker, secret)

        expect(pair.btwUser.parts.some((part) => part.type === "text" && part.text.includes(marker))).toBe(true)
        expect(pair.btwAnswer.parts.some((part) => part.type === "text" && part.text.includes(secret))).toBe(true)
      })
    })
  })

  describe("#given a tool use pair", () => {
    describe("#when the pair is built", () => {
      it("#then uses matching tool IDs", () => {
        const toolId = "toolu_fixture_1"
        const pair = buildToolUsePair("fixture_tool", toolId)
        const toolUsePart = pair.toolUse.parts[0]
        const toolResultPart = pair.toolResult.parts[0]

        expect(toolUsePart?.id).toBe(toolId)
        expect(toolResultPart && "tool_use_id" in toolResultPart ? toolResultPart.tool_use_id : undefined).toBe(toolId)
        expect(toolResultPart && "toolUseId" in toolResultPart ? toolResultPart.toolUseId : undefined).toBe(toolId)
      })
    })
  })

  describe("#given a no-op strip transform", () => {
    describe("#when the runner executes it", () => {
      it("#then returns the messages unchanged", () => {
        const messages = [buildUserMessage("hello fixture")]
        const result = runStripTransform(messages, () => {})

        expect(result).toEqual(messages)
      })
    })
  })
})

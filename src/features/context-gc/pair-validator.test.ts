import { describe, it, expect, beforeEach } from "bun:test"
import type { GcPart, MessageWithParts } from "./types"
import { buildToolCallMap, enforceToolPairAtomic } from "./pair-validator"

function createMessage(parts: GcPart[]): MessageWithParts {
  return {
    info: {
      id: "msg",
      sessionID: "ses_1",
    },
    parts,
  }
}

describe("pair-validator", () => {
  beforeEach(() => {})

  describe("#given messages containing tool parts", () => {
    describe("#when buildToolCallMap is called", () => {
      it("#then it should group tool locations by callID across messages", () => {
        const messages = [
          createMessage([
            { type: "text", text: "start" },
            { type: "tool", callID: "call_1", tool: "bash", state: { status: "completed", output: "one" } },
          ]),
          createMessage([
            { type: "tool", callID: "call_2", tool: "grep", state: { status: "completed", output: "two" } },
            { type: "tool", callID: "call_1", tool: "bash", state: { status: "completed", output: "three" } },
          ]),
          createMessage([{ type: "tool", callID: "call_2", tool: "grep", state: { status: "completed", output: "four" } }]),
        ]

        const callMap = buildToolCallMap(messages)

        expect(callMap.get("call_1")).toEqual([
          { messageIndex: 0, partIndex: 1 },
          { messageIndex: 1, partIndex: 1 },
        ])
        expect(callMap.get("call_2")).toEqual([
          { messageIndex: 1, partIndex: 0 },
          { messageIndex: 2, partIndex: 0 },
        ])
      })

      it("#then it should ignore parts without tool type or callID", () => {
        const messages = [
          createMessage([{ type: "text", text: "hello" }]),
          createMessage([{ type: "tool", tool: "bash", state: { output: "missing id" } }]),
        ]

        const callMap = buildToolCallMap(messages)

        expect(callMap.size).toBe(0)
      })
    })
  })

  describe("#given a compression index set and tool pair map", () => {
    describe("#when one half of a pair is already selected for compression", () => {
      it("#then enforceToolPairAtomic should include all message indices for that callID", () => {
        const toolMap = new Map<string, Array<{ messageIndex: number; partIndex: number }>>([
          [
            "call_1",
            [
              { messageIndex: 1, partIndex: 0 },
              { messageIndex: 3, partIndex: 0 },
            ],
          ],
          [
            "call_2",
            [
              { messageIndex: 2, partIndex: 1 },
              { messageIndex: 4, partIndex: 2 },
            ],
          ],
        ])

        const expanded = enforceToolPairAtomic(new Set([3]), toolMap)

        expect(expanded.has(1)).toBe(true)
        expect(expanded.has(3)).toBe(true)
        expect(expanded.has(2)).toBe(false)
        expect(expanded.has(4)).toBe(false)
      })
    })

    describe("#when no mapped pairs overlap with the compression set", () => {
      it("#then it should not expand the set", () => {
        const toolMap = new Map<string, Array<{ messageIndex: number; partIndex: number }>>([
          [
            "call_1",
            [
              { messageIndex: 5, partIndex: 0 },
              { messageIndex: 6, partIndex: 0 },
            ],
          ],
        ])

        const expanded = enforceToolPairAtomic(new Set([2]), toolMap)

        expect(Array.from(expanded.values())).toEqual([2])
      })
    })

    describe("#when map entries have only one tool location", () => {
      it("#then it should ignore them and keep the original set", () => {
        const toolMap = new Map<string, Array<{ messageIndex: number; partIndex: number }>>([
          ["call_1", [{ messageIndex: 4, partIndex: 0 }]],
        ])

        const expanded = enforceToolPairAtomic(new Set([1]), toolMap)

        expect(Array.from(expanded.values())).toEqual([1])
      })
    })
  })
})

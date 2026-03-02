import { describe, it, expect, beforeEach } from "bun:test"
import type { GcMessageInfo, GcPart, MessageWithParts } from "./types"
import type { TierClassification } from "./tier-classifier"
import { applyRelevancePromotions } from "./relevance-scorer"
import { storeBrainId, clearBrainIds } from "./brain-id-store"

const SESSION = "ses_rel"

function createMsg(id: string, role: string, parts: GcPart[]): MessageWithParts {
  return {
    info: { id, sessionID: SESSION, role } as GcMessageInfo,
    parts,
  }
}

function textPart(text: string): GcPart {
  return { type: "text", text } as GcPart
}

function toolPart(callID: string, output: string): GcPart {
  return { type: "tool", callID, state: { output } } as GcPart
}

function makeClassifications(tiers: Array<{ tier: TierClassification["tier"]; idx: number }>): TierClassification[] {
  return tiers.map(({ tier, idx }) => ({
    tier,
    messageIndex: idx,
    turnAge: idx,
    estimatedTokens: 100,
  }))
}

describe("relevance-scorer", () => {
  beforeEach(() => {
    clearBrainIds(SESSION)
  })

  describe("#given hot messages referencing brain markers in cold messages", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should promote the cold message to warm", () => {
        storeBrainId(SESSION, "msg_old", 42)

        const messages = [
          createMsg("msg_old", "assistant", [textPart("old response")]),
          createMsg("msg_mid", "assistant", [textPart("middle")]),
          createMsg("msg_hot", "assistant", [textPart("see [brain#42: old tool output] for context")]),
        ]

        const classifications = makeClassifications([
          { tier: "cold", idx: 0 },
          { tier: "warm", idx: 1 },
          { tier: "hot", idx: 2 },
        ])

        applyRelevancePromotions(messages, classifications)

        expect(classifications[0].tier).toBe("warm")
        expect(classifications[1].tier).toBe("warm")
        expect(classifications[2].tier).toBe("hot")
      })
    })
  })

  describe("#given hot messages referencing brain markers in gone messages", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should promote the gone message to warm", () => {
        storeBrainId(SESSION, "msg_ancient", 99)

        const messages = [
          createMsg("msg_ancient", "assistant", [textPart("ancient output")]),
          createMsg("msg_hot", "assistant", [textPart("referencing [brain#99: summary of ancient]")]),
        ]

        const classifications = makeClassifications([
          { tier: "gone", idx: 0 },
          { tier: "hot", idx: 1 },
        ])

        applyRelevancePromotions(messages, classifications)

        expect(classifications[0].tier).toBe("warm")
      })
    })
  })

  describe("#given hot messages with tool callIDs matching older messages", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should promote the older message with matching callID to warm", () => {
        const messages = [
          createMsg("msg_old", "assistant", [toolPart("call_abc", "tool output from earlier")]),
          createMsg("msg_mid", "assistant", [textPart("middle")]),
          createMsg("msg_hot", "assistant", [toolPart("call_abc", "newer tool usage")]),
        ]

        const classifications = makeClassifications([
          { tier: "cold", idx: 0 },
          { tier: "warm", idx: 1 },
          { tier: "hot", idx: 2 },
        ])

        applyRelevancePromotions(messages, classifications)

        expect(classifications[0].tier).toBe("warm")
        expect(classifications[1].tier).toBe("warm")
        expect(classifications[2].tier).toBe("hot")
      })
    })
  })

  describe("#given no hot messages", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should not change any classifications", () => {
        const messages = [
          createMsg("msg_1", "assistant", [textPart("a")]),
          createMsg("msg_2", "assistant", [textPart("b")]),
        ]

        const classifications = makeClassifications([
          { tier: "cold", idx: 0 },
          { tier: "warm", idx: 1 },
        ])

        applyRelevancePromotions(messages, classifications)

        expect(classifications[0].tier).toBe("cold")
        expect(classifications[1].tier).toBe("warm")
      })
    })
  })

  describe("#given hot messages with no references to older messages", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should leave classifications unchanged", () => {
        const messages = [
          createMsg("msg_old", "assistant", [textPart("old")]),
          createMsg("msg_hot", "assistant", [textPart("no references here")]),
        ]

        const classifications = makeClassifications([
          { tier: "cold", idx: 0 },
          { tier: "hot", idx: 1 },
        ])

        applyRelevancePromotions(messages, classifications)

        expect(classifications[0].tier).toBe("cold")
        expect(classifications[1].tier).toBe("hot")
      })
    })
  })

  describe("#given a warm message referenced by hot", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should not change warm (already at target tier)", () => {
        storeBrainId(SESSION, "msg_warm", 50)

        const messages = [
          createMsg("msg_warm", "assistant", [textPart("warm content")]),
          createMsg("msg_hot", "assistant", [textPart("see [brain#50: warm data]")]),
        ]

        const classifications = makeClassifications([
          { tier: "warm", idx: 0 },
          { tier: "hot", idx: 1 },
        ])

        applyRelevancePromotions(messages, classifications)

        expect(classifications[0].tier).toBe("warm")
      })
    })
  })

  describe("#given a hot message referenced by another hot", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should not change hot messages", () => {
        storeBrainId(SESSION, "msg_hot1", 60)

        const messages = [
          createMsg("msg_hot1", "assistant", [textPart("first hot")]),
          createMsg("msg_hot2", "assistant", [textPart("[brain#60: first hot ref]")]),
        ]

        const classifications = makeClassifications([
          { tier: "hot", idx: 0 },
          { tier: "hot", idx: 1 },
        ])

        applyRelevancePromotions(messages, classifications)

        expect(classifications[0].tier).toBe("hot")
        expect(classifications[1].tier).toBe("hot")
      })
    })
  })

  describe("#given multiple brain markers in a single hot message", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should promote all referenced cold/gone messages", () => {
        storeBrainId(SESSION, "msg_1", 10)
        storeBrainId(SESSION, "msg_2", 20)

        const messages = [
          createMsg("msg_1", "assistant", [textPart("first old")]),
          createMsg("msg_2", "assistant", [textPart("second old")]),
          createMsg("msg_3", "assistant", [textPart("middle warm")]),
          createMsg("msg_hot", "assistant", [textPart("[brain#10: first] and [brain#20: second]")]),
        ]

        const classifications = makeClassifications([
          { tier: "gone", idx: 0 },
          { tier: "cold", idx: 1 },
          { tier: "warm", idx: 2 },
          { tier: "hot", idx: 3 },
        ])

        applyRelevancePromotions(messages, classifications)

        expect(classifications[0].tier).toBe("warm")
        expect(classifications[1].tier).toBe("warm")
        expect(classifications[2].tier).toBe("warm")
        expect(classifications[3].tier).toBe("hot")
      })
    })
  })

  describe("#given tool output text contains brain markers", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should detect markers in tool state output", () => {
        storeBrainId(SESSION, "msg_old", 77)

        const messages = [
          createMsg("msg_old", "assistant", [textPart("old")]),
          createMsg("msg_hot", "assistant", [toolPart("call_xyz", "result mentions [brain#77: old data]")]),
        ]

        const classifications = makeClassifications([
          { tier: "cold", idx: 0 },
          { tier: "hot", idx: 1 },
        ])

        applyRelevancePromotions(messages, classifications)

        expect(classifications[0].tier).toBe("warm")
      })
    })
  })

  describe("#given empty messages array", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should handle gracefully with no errors", () => {
        const classifications: TierClassification[] = []

        expect(() => applyRelevancePromotions([], classifications)).not.toThrow()
        expect(classifications).toEqual([])
      })
    })
  })

  describe("#given messages with no info IDs (missing sessionID/id)", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should skip brain ID lookup without crashing", () => {
        const messages = [
          { info: { role: "assistant" }, parts: [textPart("no id")] as GcPart[] },
          createMsg("msg_hot", "assistant", [textPart("[brain#999: nonexistent ref]")]),
        ]

        const classifications = makeClassifications([
          { tier: "cold", idx: 0 },
          { tier: "hot", idx: 1 },
        ])

        expect(() => applyRelevancePromotions(messages, classifications)).not.toThrow()
        expect(classifications[0].tier).toBe("cold")
      })
    })
  })

  describe("#given both brain ID and tool callID references to the same message", () => {
    describe("#when applyRelevancePromotions is called", () => {
      it("#then should promote the message once (idempotent)", () => {
        storeBrainId(SESSION, "msg_old", 33)

        const messages = [
          createMsg("msg_old", "assistant", [toolPart("call_shared", "old tool output")]),
          createMsg("msg_hot", "assistant", [
            textPart("[brain#33: old ref]"),
            toolPart("call_shared", "new usage"),
          ]),
        ]

        const classifications = makeClassifications([
          { tier: "gone", idx: 0 },
          { tier: "hot", idx: 1 },
        ])

        applyRelevancePromotions(messages, classifications)

        expect(classifications[0].tier).toBe("warm")
      })
    })
  })
})

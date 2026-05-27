import { describe, test, expect } from "bun:test"

import {
  isCompactionAgent,
  hasCompactionPart,
  isCompactionMessage,
} from "./compaction-marker"

describe("compaction-marker", () => {
  describe("#given isCompactionAgent", () => {
    describe("#when agent is the string compaction", () => {
      test("#then returns true", () => {
        expect(isCompactionAgent("compaction")).toBe(true)
      })
    })

    describe("#when agent is compaction with different casing", () => {
      test("#then returns true (case-insensitive)", () => {
        expect(isCompactionAgent("Compaction")).toBe(true)
        expect(isCompactionAgent("COMPACTION")).toBe(true)
      })
    })

    describe("#when agent has surrounding whitespace", () => {
      test("#then returns true (trimmed)", () => {
        expect(isCompactionAgent("  compaction  ")).toBe(true)
      })
    })

    describe("#when agent is a different string", () => {
      test("#then returns false", () => {
        expect(isCompactionAgent("sisyphus")).toBe(false)
        expect(isCompactionAgent("")).toBe(false)
      })
    })

    describe("#when agent is not a string", () => {
      test("#then returns false", () => {
        expect(isCompactionAgent(null)).toBe(false)
        expect(isCompactionAgent(undefined)).toBe(false)
        expect(isCompactionAgent(123)).toBe(false)
      })
    })
  })

  describe("#given hasCompactionPart", () => {
    describe("#when parts contains a compaction type part", () => {
      test("#then returns true", () => {
        const parts = [{ type: "text" }, { type: "compaction" }]
        expect(hasCompactionPart(parts)).toBe(true)
      })
    })

    describe("#when parts has no compaction type", () => {
      test("#then returns false", () => {
        const parts = [{ type: "text" }, { type: "tool_use" }]
        expect(hasCompactionPart(parts)).toBe(false)
      })
    })

    describe("#when parts is empty", () => {
      test("#then returns false", () => {
        expect(hasCompactionPart([])).toBe(false)
      })
    })

    describe("#when parts is not an array", () => {
      test("#then returns false", () => {
        expect(hasCompactionPart(null)).toBe(false)
        expect(hasCompactionPart(undefined)).toBe(false)
        expect(hasCompactionPart("string")).toBe(false)
      })
    })
  })

  describe("#given isCompactionMessage", () => {
    describe("#when message has info.agent = compaction", () => {
      test("#then returns true", () => {
        const message = { info: { agent: "compaction" }, parts: [] }
        expect(isCompactionMessage(message)).toBe(true)
      })
    })

    describe("#when message has top-level agent = compaction", () => {
      test("#then returns true", () => {
        const message = { agent: "compaction", parts: [] }
        expect(isCompactionMessage(message)).toBe(true)
      })
    })

    describe("#when message has compaction part", () => {
      test("#then returns true", () => {
        const message = { agent: "sisyphus", parts: [{ type: "compaction" }] }
        expect(isCompactionMessage(message)).toBe(true)
      })
    })

    describe("#when message has neither compaction agent nor part", () => {
      test("#then returns false", () => {
        const message = { agent: "sisyphus", parts: [{ type: "text" }] }
        expect(isCompactionMessage(message)).toBe(false)
      })
    })

    describe("#when message has info.agent taking priority over agent", () => {
      test("#then uses info.agent first", () => {
        const message = { agent: "sisyphus", info: { agent: "compaction" }, parts: [] }
        expect(isCompactionMessage(message)).toBe(true)
      })
    })
  })
})

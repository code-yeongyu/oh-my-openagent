import { describe, it, expect, beforeEach } from "bun:test"
import type { GcPart } from "./types"
import { computeAssistantModifications } from "./compressors/assistant-response"

describe("assistant-response compressor", () => {
  beforeEach(() => {})

  describe("#given hot-tier assistant parts", () => {
    describe("#when computeAssistantModifications is called", () => {
      it("#then it should return no modifications", () => {
        const parts = [{ type: "thinking", text: "internal" }] as GcPart[]

        const result = computeAssistantModifications(parts, "hot", null)

        expect(result).toEqual([])
      })
    })
  })

  describe("#given warm and cold assistant parts", () => {
    describe("#when parts include thinking content", () => {
      it("#then thinking and reasoning parts should be marked for removal", () => {
        const parts = [
          { type: "thinking", text: "hidden chain" },
          { type: "reasoning", text: "hidden rationale" },
          { type: "text", text: "visible" },
        ] as GcPart[]

        const warmResult = computeAssistantModifications(parts, "warm", null)
        const coldResult = computeAssistantModifications(parts, "cold", null)

        expect(warmResult).toEqual([
          { partIndex: 0, action: "remove" },
          { partIndex: 1, action: "remove" },
        ])
        expect(coldResult[0]).toEqual({ partIndex: 0, action: "remove" })
        expect(coldResult[1]).toEqual({ partIndex: 1, action: "remove" })
      })
    })

    describe("#when tier is cold and text is larger than token threshold", () => {
      it("#then text parts should be marked for replace with truncation", () => {
        const longText = "a".repeat(500)
        const parts = [{ type: "text", text: longText }] as GcPart[]

        const result = computeAssistantModifications(parts, "cold", 33)

        expect(result).toHaveLength(1)
        expect(result[0]?.action).toBe("replace")
        expect(result[0]?.partIndex).toBe(0)
        expect(result[0]?.newText?.length).toBeGreaterThan(200)
        expect(result[0]?.newText).toContain("[brain#33: full response]")
      })
    })

    describe("#when text is below token threshold", () => {
      it("#then text parts should not be modified", () => {
        const parts = [{ type: "text", text: "short text" }] as GcPart[]

        const result = computeAssistantModifications(parts, "cold", null)

        expect(result).toEqual([])
      })
    })

    describe("#when part type is neither text nor thinking", () => {
      it("#then it should be left unchanged", () => {
        const parts = [{ type: "tool", tool: "bash", state: { output: "data" } }] as GcPart[]

        const result = computeAssistantModifications(parts, "cold", null)

        expect(result).toEqual([])
      })
    })
  })
})

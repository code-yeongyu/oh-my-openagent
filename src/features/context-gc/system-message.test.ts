import { describe, it, expect, beforeEach } from "bun:test"
import type { GcPart } from "./types"
import { computeSystemModifications } from "./compressors/system-message"

describe("system-message compressor", () => {
  beforeEach(() => {})

  describe("#given hot and warm tiers", () => {
    describe("#when computeSystemModifications is called", () => {
      it("#then it should return no removals", () => {
        const parts = [{ type: "text", text: "x".repeat(1000), synthetic: true }] as GcPart[]

        expect(computeSystemModifications(parts, "hot")).toEqual([])
        expect(computeSystemModifications(parts, "warm")).toEqual([])
      })
    })
  })

  describe("#given cold-tier system parts", () => {
    describe("#when a synthetic text part exceeds 200 tokens and has no keep keywords", () => {
      it("#then that part should be marked for removal", () => {
        const parts = [{ type: "text", text: "a".repeat(1000), synthetic: true }] as GcPart[]

        const result = computeSystemModifications(parts, "cold")

        expect(result).toEqual([{ partIndex: 0, action: "remove" }])
      })
    })

    describe("#when synthetic text includes keep patterns", () => {
      it("#then it should preserve those parts", () => {
        const parts = [
          { type: "text", text: "CRITICAL bootstrap identity block", synthetic: true },
          { type: "text", text: "NEVER drop this constraint", synthetic: true },
          { type: "text", text: "MUST be retained for safety", synthetic: true },
        ] as GcPart[]

        const result = computeSystemModifications(parts, "cold")

        expect(result).toEqual([])
      })
    })

    describe("#when a text part is non-synthetic", () => {
      it("#then it should not be removed even if large", () => {
        const parts = [{ type: "text", text: "a".repeat(1000), synthetic: false }] as GcPart[]

        const result = computeSystemModifications(parts, "cold")

        expect(result).toEqual([])
      })
    })
  })
})

import { describe, expect, it } from "bun:test"

import { computeTheoryHash } from "./theory-hasher"

describe("computeTheoryHash", () => {
  describe("#given same theory #when hashed twice #then same result", () => {
    it("produces deterministic hash", () => {
      const theory = { premises: [{ formula: "p(x)" }], rules: [] }

      expect(computeTheoryHash(theory)).toBe(computeTheoryHash(theory))
    })
  })

  describe("#given same content different key order #when hashed #then same hash", () => {
    it("is order-independent", () => {
      const t1 = { b: 2, a: 1 }
      const t2 = { a: 1, b: 2 }

      expect(computeTheoryHash(t1)).toBe(computeTheoryHash(t2))
    })
  })

  describe("#given different theories #when hashed #then different hashes", () => {
    it("produces distinct hashes", () => {
      const t1 = { premises: [{ formula: "p(x)" }] }
      const t2 = { premises: [{ formula: "q(x)" }] }

      expect(computeTheoryHash(t1)).not.toBe(computeTheoryHash(t2))
    })
  })

  describe("#given null or undefined #when hashed #then returns empty string", () => {
    it("handles null", () => {
      expect(computeTheoryHash(null)).toBe("")
    })

    it("handles undefined", () => {
      expect(computeTheoryHash(undefined)).toBe("")
    })
  })

  describe("#given complex nested theory #when hashed #then returns non-empty string", () => {
    it("handles nested objects", () => {
      const complex = {
        premises: [{ formula: "a(x)", kind: "ordinary" }],
        defeasible_rules: [{ id: "r1", antecedents: ["a(x)"], consequent: "b(x)" }],
        preferences: [],
        classical_negation: true,
      }

      const hash = computeTheoryHash(complex)

      expect(hash).toBeTruthy()
      expect(hash.length).toBeGreaterThan(0)
    })
  })
})

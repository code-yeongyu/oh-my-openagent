import { describe, expect, it } from "bun:test"
import { checkResurrection } from "./resurrection-engine"

describe("checkResurrection", () => {
  describe("#given excluded conclusion with changed theory hash #when checked #then should resurrect", () => {
    it("signals resurrection on hash change", () => {
      const r = checkResurrection({
        currentState: "excluded",
        exclusionTheoryHash: "abc123",
        currentTheoryHash: "def456",
      })
      expect(r.shouldResurrect).toBe(true)
    })
  })

  describe("#given excluded conclusion with same theory hash #when checked #then should not resurrect", () => {
    it("no resurrection when hash unchanged", () => {
      const r = checkResurrection({
        currentState: "excluded",
        exclusionTheoryHash: "abc123",
        currentTheoryHash: "abc123",
      })
      expect(r.shouldResurrect).toBe(false)
    })
  })

  describe("#given excluded conclusion with no stored hash (V2 migration) #when checked #then no resurrection", () => {
    it("cannot resurrect without stored hash", () => {
      const r = checkResurrection({
        currentState: "excluded",
        exclusionTheoryHash: undefined,
        currentTheoryHash: "def456",
      })
      expect(r.shouldResurrect).toBe(false)
    })
  })

  describe("#given non-excluded conclusion with changed hash #when checked #then no resurrection", () => {
    it("non-excluded states cannot resurrect", () => {
      for (const state of ["accepted", "plausible", "open", "operationally_excluded"] as const) {
        const r = checkResurrection({
          currentState: state,
          exclusionTheoryHash: "abc123",
          currentTheoryHash: "def456",
        })
        expect(r.shouldResurrect).toBe(false)
      }
    })
  })

  describe("#given excluded conclusion with empty string current hash #when checked #then no resurrection", () => {
    it("empty current hash prevents resurrection", () => {
      const r = checkResurrection({
        currentState: "excluded",
        exclusionTheoryHash: "abc123",
        currentTheoryHash: "",
      })
      expect(r.shouldResurrect).toBe(false)
    })
  })

  describe("#given excluded conclusion with empty stored hash #when checked #then no resurrection", () => {
    it("empty stored hash prevents resurrection", () => {
      const r = checkResurrection({
        currentState: "excluded",
        exclusionTheoryHash: "",
        currentTheoryHash: "abc123",
      })
      expect(r.shouldResurrect).toBe(false)
    })
  })
})

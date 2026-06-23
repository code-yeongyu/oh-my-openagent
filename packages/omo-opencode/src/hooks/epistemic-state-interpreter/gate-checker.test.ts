import { describe, expect, test } from "bun:test"

import { checkGate } from "./gate-checker"

describe("gate-checker", () => {
  describe("given annotation mode", () => {
    describe("when checking any state", () => {
      test("then it is always allowed", () => {
        const result = checkGate("excluded", "annotation", "conclusion")

        expect(result).toEqual({
          allowed: true,
          reason: "annotation mode: gate disabled",
        })
      })

      test("then it allows inconclusive states", () => {
        const result = checkGate("inconclusive", "annotation", "conclusion")

        expect(result).toEqual({
          allowed: true,
          reason: "annotation mode: gate disabled",
        })
      })

      test("then it ignores the conclusion text for inconclusive states", () => {
        const result = checkGate("inconclusive", "annotation", "dominance proof")

        expect(result.allowed).toBe(true)
        expect(result.reason).toBe("annotation mode: gate disabled")
      })
    })
  })

  describe("given gate mode", () => {
    describe("when the state is excluded", () => {
      test("then it is blocked", () => {
        const result = checkGate("excluded", "gate", "conclusion")

        expect(result).toEqual({
          allowed: false,
          reason: "gate mode: conclusion 'conclusion' blocked (state=excluded, below 'open')",
        })
      })
    })

    describe("when the state is operationally_excluded", () => {
      test("then it is blocked", () => {
        const result = checkGate("operationally_excluded", "gate", "conclusion")

        expect(result).toEqual({
          allowed: false,
          reason: "gate mode: conclusion 'conclusion' blocked (state=operationally_excluded, below 'open')",
        })
      })
    })

    describe("when the state is inconclusive", () => {
      test("then it is blocked fail-closed", () => {
        const result = checkGate("inconclusive", "gate", "conclusion")

        expect(result).toEqual({
          allowed: false,
          reason: "gate mode: conclusion 'conclusion' blocked (state=inconclusive, fail-closed)",
        })
      })

      test("then it includes a descriptive fail-closed reason", () => {
        const result = checkGate("inconclusive", "gate", "dominance proof")

        expect(result.allowed).toBe(false)
        expect(result.reason).toBe(
          "gate mode: conclusion 'dominance proof' blocked (state=inconclusive, fail-closed)"
        )
      })
    })

    describe("when the state is open", () => {
      test("then it is allowed", () => {
        const result = checkGate("open", "gate", "conclusion")

        expect(result).toEqual({
          allowed: true,
          reason: "gate mode: state open >= open",
        })
      })
    })

    describe("when the state is plausible", () => {
      test("then it is allowed", () => {
        const result = checkGate("plausible", "gate", "conclusion")

        expect(result).toEqual({
          allowed: true,
          reason: "gate mode: state plausible >= open",
        })
      })
    })

    describe("when the state is accepted", () => {
      test("then it is allowed", () => {
        const result = checkGate("accepted", "gate", "conclusion")

        expect(result).toEqual({
          allowed: true,
          reason: "gate mode: state accepted >= open",
        })
      })
    })
  })

  describe("given hybrid mode", () => {
    describe("when the state is excluded", () => {
      test("then it is blocked", () => {
        const result = checkGate("excluded", "hybrid", "conclusion")

        expect(result).toEqual({
          allowed: false,
          reason: "hybrid mode: conclusion 'conclusion' blocked (state=excluded)",
        })
      })
    })

    describe("when the state is open", () => {
      test("then it is allowed", () => {
        const result = checkGate("open", "hybrid", "conclusion")

        expect(result).toEqual({
          allowed: true,
          reason: "hybrid mode: state open allowed",
        })
      })
    })

    describe("when the state is inconclusive", () => {
      test("then it is blocked fail-closed", () => {
        const result = checkGate("inconclusive", "hybrid", "conclusion")

        expect(result).toEqual({
          allowed: false,
          reason: "hybrid mode: conclusion 'conclusion' blocked (state=inconclusive, fail-closed)",
        })
      })

      test("then it stays fail-closed for a different conclusion", () => {
        const result = checkGate("inconclusive", "hybrid", "dominance proof")

        expect(result.allowed).toBe(false)
        expect(result.reason).toBe(
          "hybrid mode: conclusion 'dominance proof' blocked (state=inconclusive, fail-closed)"
        )
      })
    })
  })

  describe("given dominance mode", () => {
    describe("when the state is excluded", () => {
      test("then it is blocked", () => {
        const result = checkGate("excluded", "dominance", "conclusion")

        expect(result).toEqual({
          allowed: false,
          reason: "dominance mode: conclusion 'conclusion' blocked (state=excluded)",
        })
      })
    })

    describe("when the state is operationally_excluded", () => {
      test("then it is blocked", () => {
        const result = checkGate("operationally_excluded", "dominance", "conclusion")

        expect(result).toEqual({
          allowed: false,
          reason: "dominance mode: conclusion 'conclusion' blocked (state=operationally_excluded)",
        })
      })
    })

    describe("when the state is inconclusive", () => {
      test("then it is blocked", () => {
        const result = checkGate("inconclusive", "dominance", "conclusion")

        expect(result).toEqual({
          allowed: false,
          reason: "dominance mode: conclusion 'conclusion' blocked (state=inconclusive)",
        })
      })

      test("then it blocks a different conclusion", () => {
        const result = checkGate("inconclusive", "dominance", "dominance proof")

        expect(result.allowed).toBe(false)
        expect(result.reason).toBe(
          "dominance mode: conclusion 'dominance proof' blocked (state=inconclusive)"
        )
      })
    })

    describe("when the state is open", () => {
      test("then it is allowed", () => {
        const result = checkGate("open", "dominance", "conclusion")

        expect(result).toEqual({
          allowed: true,
          reason: "dominance mode: state open allowed",
        })
      })
    })

    describe("when the state is plausible", () => {
      test("then it is allowed", () => {
        const result = checkGate("plausible", "dominance", "conclusion")

        expect(result).toEqual({
          allowed: true,
          reason: "dominance mode: state plausible allowed",
        })
      })
    })

    describe("when the state is accepted", () => {
      test("then it is allowed", () => {
        const result = checkGate("accepted", "dominance", "conclusion")

        expect(result).toEqual({
          allowed: true,
          reason: "dominance mode: state accepted allowed",
        })
      })
    })
  })
})

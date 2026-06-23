import { describe, expect, test } from "bun:test"

import {
  createInitialCycleState,
  updateCycleState,
  detectPreferenceCycle,
} from "./preference-circuit-breaker"

describe("preference-circuit-breaker", () => {
  describe("given a fresh cycle state", () => {
    describe("when creating the initial state", () => {
      test("then it has all zeros and is not frozen", () => {
        const state = createInitialCycleState()

        expect(state).toEqual({
          cycleCount: 0,
          lastDirection: "none",
          oscillationCount: 0,
          frozen: false,
        })
      })
    })
  })

  describe("given a moving preference cycle", () => {
    describe("when one direction flip occurs", () => {
      test("then it does not freeze", () => {
        const initial = createInitialCycleState()
        const afterUp = updateCycleState(initial, 0, 1)
        const afterFlip = updateCycleState(afterUp, 1, 0)

        expect(afterFlip.frozen).toBe(false)
      })
    })

    describe("when four consecutive flips occur", () => {
      test("then the circuit breaker does not freeze", () => {
        let state = createInitialCycleState()
        state = updateCycleState(state, 0, 1)
        state = updateCycleState(state, 1, 0)
        state = updateCycleState(state, 0, 1)
        state = updateCycleState(state, 1, 0)
        state = updateCycleState(state, 0, 1)

        expect(state.frozen).toBe(false)
      })
    })

    describe("when five consecutive oscillations occur", () => {
      test("then the circuit breaker freezes", () => {
        let state = createInitialCycleState()
        state = updateCycleState(state, 0, 1)
        state = updateCycleState(state, 1, 0)
        state = updateCycleState(state, 0, 1)
        state = updateCycleState(state, 1, 0)
        state = updateCycleState(state, 0, 1)
        state = updateCycleState(state, 1, 0)

        expect(state.frozen).toBe(true)
      })
    })

    describe("when the state is frozen", () => {
      test("then it does not update", () => {
        const state = {
          cycleCount: 10,
          lastDirection: "up" as const,
          oscillationCount: 5,
          frozen: true,
        }

        const nextState = updateCycleState(state, 1, 0)

        expect(nextState).toBe(state)
      })
    })

    describe("when direction does not change", () => {
      test("then there is no oscillation", () => {
        const initial = createInitialCycleState()
        const afterUp = updateCycleState(initial, 0, 1)
        const afterNone = updateCycleState(afterUp, 1, 1)

        expect(afterNone.oscillationCount).toBe(0)
        expect(afterNone.lastDirection).toBe("up")
      })
    })
  })

  describe("given preference graph cycle detection", () => {
    describe("when preferences form a cycle (A>B, B>C, C>A)", () => {
      test("then it detects the cycle and returns the path", () => {
        const preferences = [
          { superior: "A", inferior: "B" },
          { superior: "B", inferior: "C" },
          { superior: "C", inferior: "A" },
        ]

        const result = detectPreferenceCycle(preferences)

        expect(result.detected).toBe(true)
        expect(result.path.length).toBeGreaterThanOrEqual(3)
        expect(result.path).toContain("A")
        expect(result.path).toContain("B")
        expect(result.path).toContain("C")
      })
    })

    describe("when preferences are acyclic (A>B, B>C)", () => {
      test("then it reports no cycle", () => {
        const preferences = [
          { superior: "A", inferior: "B" },
          { superior: "B", inferior: "C" },
        ]

        const result = detectPreferenceCycle(preferences)

        expect(result.detected).toBe(false)
        expect(result.path).toEqual([])
      })
    })

    describe("when preferences are empty", () => {
      test("then it reports no cycle", () => {
        const result = detectPreferenceCycle([])

        expect(result.detected).toBe(false)
        expect(result.path).toEqual([])
      })
    })

    describe("when a single preference exists", () => {
      test("then it reports no cycle", () => {
        const preferences = [{ superior: "A", inferior: "B" }]

        const result = detectPreferenceCycle(preferences)

        expect(result.detected).toBe(false)
        expect(result.path).toEqual([])
      })
    })

    describe("when a self-loop exists (A>A)", () => {
      test("then it detects the cycle", () => {
        const preferences = [{ superior: "A", inferior: "A" }]

        const result = detectPreferenceCycle(preferences)

        expect(result.detected).toBe(true)
        expect(result.path).toContain("A")
      })
    })

    describe("when a longer cycle exists among acyclic edges", () => {
      test("then it still detects the cycle", () => {
        const preferences = [
          { superior: "X", inferior: "Y" },
          { superior: "A", inferior: "B" },
          { superior: "B", inferior: "C" },
          { superior: "C", inferior: "D" },
          { superior: "D", inferior: "A" },
        ]

        const result = detectPreferenceCycle(preferences)

        expect(result.detected).toBe(true)
        expect(result.path.length).toBeGreaterThanOrEqual(4)
      })
    })
  })
})

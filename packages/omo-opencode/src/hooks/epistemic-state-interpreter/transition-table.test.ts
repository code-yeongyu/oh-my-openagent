import { describe, expect, it } from "bun:test"
import { THRESHOLDS, TRANSITION_TABLE, buildTransitionTable, getApplicableTransition, isValidTransition } from "./transition-table.ts"
import { DEFAULT_THRESHOLDS } from "./threshold-provider.ts"
import type { EpistemicState } from "./types.ts"
import type { TransitionID } from "./transition-types.ts"

const VALID_PAIRS: Array<[TransitionID, EpistemicState, EpistemicState]> = [
  ["T1", "open", "plausible"],
  ["T2", "plausible", "accepted"],
  ["T3", "operationally_excluded", "open"],
  ["T4", "accepted", "plausible"],
  ["T5", "plausible", "open"],
  ["T6", "open", "operationally_excluded"],
  ["T7", "accepted", "open"],
  ["T8", "plausible", "operationally_excluded"],
  ["T9", "accepted", "operationally_excluded"],
  ["T10", "open", "excluded"],
  ["T11", "operationally_excluded", "excluded"],
  ["T12", "excluded", "excluded"],
  ["T13", "excluded", "open"],
]

const INVALID_PAIRS: Array<[EpistemicState, EpistemicState]> = [
  ["accepted", "excluded"],
  ["plausible", "excluded"],
  ["operationally_excluded", "accepted"],
  ["operationally_excluded", "plausible"],
  ["excluded", "accepted"],
  ["excluded", "plausible"],
  ["excluded", "operationally_excluded"],
]

describe("transition-table", () => {
  describe("#given threshold constants", () => {
    it("#when reading N #then equals 3", () => {
      expect(THRESHOLDS.N).toBe(3)
    })

    it("#when reading M #then equals 5", () => {
      expect(THRESHOLDS.M).toBe(5)
    })

    it("#when reading K #then equals 10", () => {
      expect(THRESHOLDS.K).toBe(10)
    })
  })

  describe("#given the transition table", () => {
    it("#when checking ids #then contains T1 through T12", () => {
      const ids = TRANSITION_TABLE.map((transition) => transition.id)
      expect(ids).toHaveLength(13)
      for (const id of ["T1", "T2", "T3", "T4", "T5", "T6", "T7", "T8", "T9", "T10", "T11", "T12", "T13"] as TransitionID[]) {
        expect(ids).toContain(id)
      }
    })

    it("#when checking pair uniqueness #then each transition pair appears once", () => {
      const pairs = TRANSITION_TABLE.map((transition) => `${transition.from}->${transition.to}`)
      expect(new Set(pairs).size).toBe(13)
    })
  })

  describe("#given valid transition pairs", () => {
    for (const [id, from, to] of VALID_PAIRS) {
      it(`#when looking up ${id} from ${from} to ${to} #then returns the definition`, () => {
        const transition = getApplicableTransition(from, to)
        expect(transition).toBeDefined()
        expect(transition).toEqual(expect.objectContaining({ id, from, to }))
      })
    }

    it("#when validating all valid pairs #then returns true", () => {
      for (const [, from, to] of VALID_PAIRS) {
        expect(isValidTransition(from, to)).toBe(true)
      }
    })
  })

  describe("#given invalid transition pairs", () => {
    for (const [from, to] of INVALID_PAIRS) {
      it(`#when looking up ${from} to ${to} #then returns undefined`, () => {
        expect(getApplicableTransition(from, to)).toBeUndefined()
      })
    }

    it("#when validating all invalid pairs #then returns false", () => {
      for (const [from, to] of INVALID_PAIRS) {
        expect(isValidTransition(from, to)).toBe(false)
      }
    })
  })

  describe("#given same-state transitions", () => {
    it("#when looking up open to open #then returns undefined", () => {
      expect(getApplicableTransition("open", "open")).toBeUndefined()
    })
  })

  describe("#given threshold groups", () => {
    it("#when reading T1 through T6 #then thresholdValue is N", () => {
      for (const id of ["T1", "T2", "T3", "T4", "T5", "T6"] as TransitionID[]) {
        expect(TRANSITION_TABLE.find((transition) => transition.id === id)?.thresholdValue).toBe(THRESHOLDS.N)
      }
    })

    it("#when reading T7 through T9 #then thresholdValue is M", () => {
      for (const id of ["T7", "T8", "T9"] as TransitionID[]) {
        expect(TRANSITION_TABLE.find((transition) => transition.id === id)?.thresholdValue).toBe(THRESHOLDS.M)
      }
    })

    it("#when reading T10 and T11 #then thresholdValue is K", () => {
      for (const id of ["T10", "T11"] as TransitionID[]) {
        expect(TRANSITION_TABLE.find((transition) => transition.id === id)?.thresholdValue).toBe(THRESHOLDS.K)
      }
    })

    it("#when reading T12 #then thresholdValue is 1", () => {
      expect(TRANSITION_TABLE.find((transition) => transition.id === "T12")?.thresholdValue).toBe(1)
    })

    it("#when reading T13 #then thresholdValue is 1", () => {
      expect(TRANSITION_TABLE.find((transition) => transition.id === "T13")?.thresholdValue).toBe(1)
    })
  })

  describe("#given custom thresholds", () => {
    it("#when building a table #then uses configured threshold values", () => {
      const table = buildTransitionTable({ N: 7, M: 9, K: 11, T: 13 })
      expect(table.find((transition) => transition.id === "T1")?.thresholdValue).toBe(7)
      expect(table.find((transition) => transition.id === "T7")?.thresholdValue).toBe(9)
      expect(table.find((transition) => transition.id === "T10")?.thresholdValue).toBe(11)
      expect(table.find((transition) => transition.id === "T13")?.thresholdValue).toBe(1)
    })

    it("#when resolving against a custom table #then lookup still works", () => {
      const table = buildTransitionTable(DEFAULT_THRESHOLDS)
      expect(getApplicableTransition("excluded", "open", table)?.id).toBe("T13")
      expect(isValidTransition("excluded", "open", table)).toBe(true)
    })
  })
})

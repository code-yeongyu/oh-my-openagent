import { describe, expect, it } from "bun:test"
import { computeTransition } from "./transition-engine"
import type { EpistemicState } from "./types"

const makeHistory = (classification: EpistemicState) => [
  { classification, timestamp: 0, callID: "c1" },
]

describe("computeTransition", () => {
  describe("#given N-threshold transitions", () => {
    it("#when T1 reaches count 3 #then transitions open to plausible", () => {
      const result = computeTransition({ currentState: "open", newClassification: "plausible", consecutiveCount: 3, history: makeHistory("plausible") })
      expect(result.newState).toBe("plausible")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T1", from: "open", to: "plausible" }))
    })

    it("#when T2 reaches count 3 #then transitions plausible to accepted", () => {
      const result = computeTransition({ currentState: "plausible", newClassification: "accepted", consecutiveCount: 3, history: makeHistory("accepted") })
      expect(result.newState).toBe("accepted")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T2", from: "plausible", to: "accepted" }))
    })

    it("#when T3 reaches count 3 #then transitions operationally_excluded to open", () => {
      const result = computeTransition({ currentState: "operationally_excluded", newClassification: "open", consecutiveCount: 3, history: makeHistory("open") })
      expect(result.newState).toBe("open")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T3", from: "operationally_excluded", to: "open" }))
    })

    it("#when T4 reaches count 3 #then transitions accepted to plausible", () => {
      const result = computeTransition({ currentState: "accepted", newClassification: "plausible", consecutiveCount: 3, history: makeHistory("plausible") })
      expect(result.newState).toBe("plausible")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T4", from: "accepted", to: "plausible" }))
    })

    it("#when T5 reaches count 3 #then transitions plausible to open", () => {
      const result = computeTransition({ currentState: "plausible", newClassification: "open", consecutiveCount: 3, history: makeHistory("open") })
      expect(result.newState).toBe("open")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T5", from: "plausible", to: "open" }))
    })

    it("#when T6 reaches count 3 #then transitions open to operationally_excluded", () => {
      const result = computeTransition({ currentState: "open", newClassification: "operationally_excluded", consecutiveCount: 3, history: makeHistory("operationally_excluded") })
      expect(result.newState).toBe("operationally_excluded")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T6", from: "open", to: "operationally_excluded" }))
    })

    it("#when count stays below N for T1 #then remains open", () => {
      const result = computeTransition({ currentState: "open", newClassification: "plausible", consecutiveCount: 2, history: makeHistory("plausible") })
      expect(result.newState).toBe("open")
      expect(result.transition).toBeNull()
    })

    it("#when E2 oscillation stops at count 2 #then remains open", () => {
      const result = computeTransition({ currentState: "open", newClassification: "plausible", consecutiveCount: 2, history: makeHistory("plausible") })
      expect(result.newState).toBe("open")
      expect(result.transition).toBeNull()
    })
  })

  describe("#given M-threshold transitions", () => {
    it("#when T7 reaches count 5 #then transitions accepted to open", () => {
      const result = computeTransition({ currentState: "accepted", newClassification: "open", consecutiveCount: 5, history: makeHistory("open") })
      expect(result.newState).toBe("open")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T7", from: "accepted", to: "open" }))
    })

    it("#when T8 reaches count 5 #then transitions plausible to operationally_excluded", () => {
      const result = computeTransition({ currentState: "plausible", newClassification: "operationally_excluded", consecutiveCount: 5, history: makeHistory("operationally_excluded") })
      expect(result.newState).toBe("operationally_excluded")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T8", from: "plausible", to: "operationally_excluded" }))
    })

    it("#when T9 reaches count 5 #then transitions accepted to operationally_excluded", () => {
      const result = computeTransition({ currentState: "accepted", newClassification: "operationally_excluded", consecutiveCount: 5, history: makeHistory("operationally_excluded") })
      expect(result.newState).toBe("operationally_excluded")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T9", from: "accepted", to: "operationally_excluded" }))
    })

    it("#when count stays below M for T7 #then remains accepted", () => {
      const result = computeTransition({ currentState: "accepted", newClassification: "open", consecutiveCount: 4, history: makeHistory("open") })
      expect(result.newState).toBe("accepted")
      expect(result.transition).toBeNull()
    })
  })

  describe("#given K-threshold and terminal transitions", () => {
    it("#when T10 reaches count 10 #then transitions open to excluded", () => {
      const result = computeTransition({ currentState: "open", newClassification: "excluded", consecutiveCount: 10, history: makeHistory("excluded") })
      expect(result.newState).toBe("excluded")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T10", from: "open", to: "excluded" }))
    })

    it("#when T11 reaches count 10 #then transitions operationally_excluded to excluded", () => {
      const result = computeTransition({ currentState: "operationally_excluded", newClassification: "excluded", consecutiveCount: 10, history: makeHistory("excluded") })
      expect(result.newState).toBe("excluded")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T11", from: "operationally_excluded", to: "excluded" }))
    })

    it("#when current state is excluded with excluded classification #then stays excluded", () => {
      const result = computeTransition({ currentState: "excluded", newClassification: "excluded", consecutiveCount: 1, history: makeHistory("excluded") })
      expect(result.newState).toBe("excluded")
      expect(result.transition).toBeNull()
    })

    it("#when current state is excluded with accepted classification #then stays excluded", () => {
      const result = computeTransition({ currentState: "excluded", newClassification: "accepted", consecutiveCount: 100, history: makeHistory("accepted") })
      expect(result.newState).toBe("excluded")
      expect(result.transition).toBeNull()
    })

    it("#when current state is excluded with plausible classification #then stays excluded", () => {
      const result = computeTransition({ currentState: "excluded", newClassification: "plausible", consecutiveCount: 100, history: makeHistory("plausible") })
      expect(result.newState).toBe("excluded")
      expect(result.transition).toBeNull()
    })
  })

  describe("#given edge-case inputs", () => {
    it("#when history is empty #then returns new classification directly", () => {
      const result = computeTransition({ currentState: "open", newClassification: "accepted", consecutiveCount: 0, history: [] })
      expect(result.newState).toBe("accepted")
      expect(result.transition).toBeNull()
    })

    it("#when current state is inconclusive with open classification #then treats it as open", () => {
      const result = computeTransition({ currentState: "inconclusive", newClassification: "open", consecutiveCount: 3, history: makeHistory("open") })
      expect(result.newState).toBe("open")
      expect(result.transition).toBeNull()
    })

    it("#when current state is inconclusive with accepted classification #then recovers toward accepted", () => {
      const result = computeTransition({ currentState: "inconclusive", newClassification: "accepted", consecutiveCount: 3, history: makeHistory("accepted") })
      expect(result.newState).toBe("open")
      expect(result.transition).toBeNull()
    })

    it("#when current state is inconclusive with excluded classification #then descends as if open", () => {
      const result = computeTransition({ currentState: "inconclusive", newClassification: "excluded", consecutiveCount: 10, history: makeHistory("excluded") })
      expect(result.newState).toBe("excluded")
      expect(result.transition).toEqual(expect.objectContaining({ id: "T10", from: "open", to: "excluded" }))
    })

    it("#when new classification is inconclusive #then returns current state unchanged", () => {
      const result = computeTransition({ currentState: "plausible", newClassification: "inconclusive", consecutiveCount: 99, history: makeHistory("plausible") })
      expect(result.newState).toBe("plausible")
      expect(result.transition).toBeNull()
    })

    it("#when transition pair is invalid #then keeps current state", () => {
      const result = computeTransition({ currentState: "accepted", newClassification: "excluded", consecutiveCount: 10, history: makeHistory("excluded") })
      expect(result.newState).toBe("accepted")
      expect(result.transition).toBeNull()
    })

    it("#when transition fires #then emits transition record details", () => {
      const result = computeTransition({ currentState: "accepted", newClassification: "open", consecutiveCount: 5, history: makeHistory("open") })
      expect(result.transition).toEqual(expect.objectContaining({ id: "T7", from: "accepted", to: "open", reason: "consecutiveCount=5 >= threshold=5", conclusion: "" }))
      expect(result.transition?.timestamp).toBeTypeOf("number")
    })
  })
})

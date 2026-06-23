import { describe, expect, it } from "bun:test"

import { computeDecay } from "./decay-engine"

const T = 50

describe("computeDecay", () => {
  describe("#given accepted conclusion absent for T invocations #when decay checked #then decays to plausible", () => {
    it("accepted -> plausible at threshold", () => {
      const result = computeDecay({
        currentState: "accepted",
        lastSeenInvocation: 0,
        currentInvocation: T,
        decayThreshold: T,
      })

      expect(result.newState).toBe("plausible")
      expect(result.decayed).toBe(true)
    })
  })

  describe("#given plausible conclusion absent for T #when decay checked #then decays to open", () => {
    it("plausible -> open at threshold", () => {
      const result = computeDecay({
        currentState: "plausible",
        lastSeenInvocation: 0,
        currentInvocation: T,
        decayThreshold: T,
      })

      expect(result.newState).toBe("open")
      expect(result.decayed).toBe(true)
    })
  })

  describe("#given open conclusion absent for T #when decay checked #then decays to operationally_excluded", () => {
    it("open -> operationally_excluded at threshold", () => {
      const result = computeDecay({
        currentState: "open",
        lastSeenInvocation: 0,
        currentInvocation: T,
        decayThreshold: T,
      })

      expect(result.newState).toBe("operationally_excluded")
      expect(result.decayed).toBe(true)
    })
  })

  describe("#given operationally_excluded absent for T #when decay checked #then decays to excluded", () => {
    it("operationally_excluded -> excluded at threshold", () => {
      const result = computeDecay({
        currentState: "operationally_excluded",
        lastSeenInvocation: 0,
        currentInvocation: T,
        decayThreshold: T,
      })

      expect(result.newState).toBe("excluded")
      expect(result.decayed).toBe(true)
    })
  })

  describe("#given excluded state #when decay checked #then does not decay further", () => {
    it("excluded stays excluded", () => {
      const result = computeDecay({
        currentState: "excluded",
        lastSeenInvocation: 0,
        currentInvocation: T * 10,
        decayThreshold: T,
      })

      expect(result.newState).toBe("excluded")
      expect(result.decayed).toBe(false)
    })
  })

  describe("#given inconclusive state absent for T #when decay checked #then treats it as open", () => {
    it("inconclusive -> operationally_excluded at threshold", () => {
      const result = computeDecay({
        currentState: "inconclusive",
        lastSeenInvocation: 0,
        currentInvocation: T,
        decayThreshold: T,
      })

      expect(result.newState).toBe("operationally_excluded")
      expect(result.decayed).toBe(true)
    })
  })

  describe("#given accepted absent for T-1 invocations #when decay checked #then no decay", () => {
    it("does not decay before threshold", () => {
      const result = computeDecay({
        currentState: "accepted",
        lastSeenInvocation: 0,
        currentInvocation: T - 1,
        decayThreshold: T,
      })

      expect(result.newState).toBe("accepted")
      expect(result.decayed).toBe(false)
    })
  })

  describe("#given accepted absent for exactly T invocations #when decay checked #then decays once", () => {
    it("decays exactly at threshold", () => {
      const result = computeDecay({
        currentState: "accepted",
        lastSeenInvocation: 100,
        currentInvocation: 150,
        decayThreshold: T,
      })

      expect(result.newState).toBe("plausible")
      expect(result.decayed).toBe(true)
    })
  })

  describe("#given accepted absent for 2T invocations #when decay checked #then decays only ONE level (atomic)", () => {
    it("only decays one level even at 2x threshold", () => {
      const result = computeDecay({
        currentState: "accepted",
        lastSeenInvocation: 0,
        currentInvocation: T * 2,
        decayThreshold: T,
      })

      expect(result.newState).toBe("plausible")
      expect(result.decayed).toBe(true)
    })
  })

  describe("#given custom threshold T=20 #when absent for 20 #then decays", () => {
    it("respects custom threshold", () => {
      const result = computeDecay({
        currentState: "plausible",
        lastSeenInvocation: 80,
        currentInvocation: 100,
        decayThreshold: 20,
      })

      expect(result.newState).toBe("open")
      expect(result.decayed).toBe(true)
    })
  })

  describe("#given operationally_excluded absent for less than threshold #when decay checked #then no decay", () => {
    it("keeps operationally_excluded before threshold", () => {
      const result = computeDecay({
        currentState: "operationally_excluded",
        lastSeenInvocation: 10,
        currentInvocation: 59,
        decayThreshold: T,
      })

      expect(result.newState).toBe("operationally_excluded")
      expect(result.decayed).toBe(false)
    })
  })

  describe("#given lastSeenInvocation undefined (V2 migration) #when decay checked #then handles gracefully", () => {
    it("handles undefined lastSeenInvocation as 0", () => {
      const result = computeDecay({
        currentState: "accepted",
        lastSeenInvocation: 0,
        currentInvocation: T,
        decayThreshold: T,
      })

      expect(result.newState).toBe("plausible")
      expect(result.decayed).toBe(true)
    })
  })
})

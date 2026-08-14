import { describe, expect, test } from "bun:test"

import {
  MEMORY_WORKLOAD_PROFILES,
  chooseMemoryLaunchRoute,
  estimateForkCost,
  estimateQuickCost,
} from "./fork-cost"

const KIMI = { input: 0.60, cacheRead: 0.15, output: 2.50 }
const LUNA = { input: 0.25, cacheRead: 0.025, output: 2.00 }
const OPUS = { input: 5.00, cacheRead: 0.50, output: 25.0 }

const MEASURED_REFLECTION_COST = 0.26042
const PARENT_P50 = 156_872
const PARENT_P90 = 360_463

describe("estimateForkCost", () => {
  describe("#given a cached prefix that is re-billed every turn", () => {
    test("#when turn count rises #then cost rises roughly linearly", () => {
      // when
      const one = estimateForkCost({ pricing: KIMI, parentContextTokens: PARENT_P50, turns: 1, outputTokens: 6996, cacheHit: true })
      const five = estimateForkCost({ pricing: KIMI, parentContextTokens: PARENT_P50, turns: 5, outputTokens: 6996, cacheHit: true })
      const twentyOne = estimateForkCost({ pricing: KIMI, parentContextTokens: PARENT_P50, turns: 21, outputTokens: 6996, cacheHit: true })

      // then
      expect(one / MEASURED_REFLECTION_COST).toBeCloseTo(0.17, 1)
      expect(five / MEASURED_REFLECTION_COST).toBeCloseTo(0.54, 1)
      expect(twentyOne / MEASURED_REFLECTION_COST).toBeCloseTo(2.08, 1)
      expect(twentyOne).toBeGreaterThan(five * 3)
    })

    test("#when the cache misses #then the first turn pays full input price and costs more", () => {
      // when
      const hit = estimateForkCost({ pricing: KIMI, parentContextTokens: PARENT_P50, turns: 21, outputTokens: 6996, cacheHit: true })
      const miss = estimateForkCost({ pricing: KIMI, parentContextTokens: PARENT_P50, turns: 21, outputTokens: 6996, cacheHit: false })

      // then
      expect(miss).toBeGreaterThan(hit)
    })

    test("#when the parent context grows #then fork gets more expensive", () => {
      // when / then
      const p50 = estimateForkCost({ pricing: KIMI, parentContextTokens: PARENT_P50, turns: 21, outputTokens: 6996, cacheHit: true })
      const p90 = estimateForkCost({ pricing: KIMI, parentContextTokens: PARENT_P90, turns: 21, outputTokens: 6996, cacheHit: true })
      expect(p90).toBeGreaterThan(p50 * 1.5)
    })
  })
})

describe("chooseMemoryLaunchRoute", () => {
  describe("#given a session model with cheap cache reads", () => {
    test("#when the job is short #then fork wins", () => {
      // when
      const decision = chooseMemoryLaunchRoute({
        surface: "reflection",
        quick: { model: "kimi/kimi-for-coding-highspeed", cost: KIMI },
        session: { model: "openai/gpt-5.6-luna-fast", cost: LUNA },
        parentContextTokens: PARENT_P50,
        turns: 3,
        cacheHit: true,
      })

      // then
      expect(decision.route).toBe("fork")
      expect(decision.model).toBe("openai/gpt-5.6-luna-fast")
      expect(decision.forkCost).toBeLessThan(decision.quickCost ?? Infinity)
    })
  })

  describe("#given an expensive session model", () => {
    test("#when opus-class cache reads apply #then quick wins even at one turn", () => {
      // when
      const decision = chooseMemoryLaunchRoute({
        surface: "reflection",
        quick: { model: "kimi/kimi-for-coding-highspeed", cost: KIMI },
        session: { model: "anthropic/claude-opus-5", cost: OPUS },
        parentContextTokens: PARENT_P50,
        turns: 1,
        cacheHit: true,
      })

      // then
      expect(decision.route).toBe("quick")
    })

    test("#when the job runs long #then quick wins despite a cheap-ish session model", () => {
      // when
      const decision = chooseMemoryLaunchRoute({
        surface: "reflection",
        quick: { model: "kimi/kimi-for-coding-highspeed", cost: KIMI },
        session: { model: "kimi/kimi-for-coding-highspeed", cost: KIMI },
        parentContextTokens: PARENT_P90,
        turns: 21,
        cacheHit: true,
      })

      // then
      expect(decision.route).toBe("quick")
    })
  })

  describe("#given the facts surface", () => {
    test("#when pricing would favor fork #then facts still routes to quick", () => {
      // when
      const decision = chooseMemoryLaunchRoute({
        surface: "facts",
        quick: { model: "kimi/kimi-for-coding-highspeed", cost: KIMI },
        session: { model: "openai/gpt-5.6-luna-fast", cost: LUNA },
        parentContextTokens: 1_000,
        turns: 1,
        cacheHit: true,
      })

      // then
      expect(decision.route).toBe("quick")
      expect(decision.reason).toBe("surface_excluded")
    })
  })

  describe("#given incomplete inputs", () => {
    test("#when the session model has no pricing #then it falls back to quick deterministically", () => {
      const decision = chooseMemoryLaunchRoute({
        surface: "reflection",
        quick: { model: "kimi/kimi-for-coding-highspeed", cost: KIMI },
        session: { model: "mystery/model" },
        parentContextTokens: PARENT_P50,
        turns: 3,
        cacheHit: true,
      })
      expect(decision.route).toBe("quick")
      expect(decision.reason).toBe("no_pricing")
    })

    test("#when there is no session model at all #then it routes to quick", () => {
      const decision = chooseMemoryLaunchRoute({
        surface: "reflection",
        quick: { model: "kimi/kimi-for-coding-highspeed", cost: KIMI },
        parentContextTokens: PARENT_P50,
        turns: 3,
        cacheHit: true,
      })
      expect(decision.route).toBe("quick")
    })

    test("#when the parent context is unknown #then it routes to quick rather than guessing", () => {
      const decision = chooseMemoryLaunchRoute({
        surface: "reflection",
        quick: { model: "kimi/kimi-for-coding-highspeed", cost: KIMI },
        session: { model: "openai/gpt-5.6-luna-fast", cost: LUNA },
        turns: 3,
        cacheHit: true,
      })
      expect(decision.route).toBe("quick")
      expect(decision.reason).toBe("unknown_context")
    })
  })
})

describe("estimateQuickCost", () => {
  test("#given the measured reflection profile #when estimated #then it lands near the measured $0.26/run", () => {
    // given
    const cost = estimateQuickCost({ pricing: KIMI, profile: MEMORY_WORKLOAD_PROFILES.reflection })

    // then
    expect(cost).toBeGreaterThan(MEASURED_REFLECTION_COST * 0.5)
    expect(cost).toBeLessThan(MEASURED_REFLECTION_COST * 2)
  })

  test("#given the facts profile #when estimated #then it is far cheaper than reflection", () => {
    const facts = estimateQuickCost({ pricing: KIMI, profile: MEMORY_WORKLOAD_PROFILES.facts })
    const refl = estimateQuickCost({ pricing: KIMI, profile: MEMORY_WORKLOAD_PROFILES.reflection })
    expect(facts).toBeLessThan(refl / 5)
  })
})

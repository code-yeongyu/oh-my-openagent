import { describe, expect, test } from "bun:test"

import { chooseReflectionLaunchModel } from "./model-cost"

const cheapFresh = { model: "google/gemini-3.6-flash", cost: { input: 0.3, cacheRead: 0.03 } }
const expensiveFresh = { model: "openai/gpt-5.6-sol", cost: { input: 1.75, cacheRead: 0.175 } }
const sessionOpus = { model: "anthropic/claude-opus-5", cost: { input: 5, cacheRead: 0.5 } }
const sessionHaiku = { model: "anthropic/claude-haiku-4-5", cost: { input: 0.8, cacheRead: 0.08 } }

describe("chooseReflectionLaunchModel", () => {
  describe("#given no cache reuse is possible", () => {
    test("#when the fresh candidate is cheaper per token #then it launches fresh", () => {
      // when
      const decision = chooseReflectionLaunchModel({
        fresh: cheapFresh,
        session: sessionOpus,
        prefixTokens: 120_000,
        workloadTokens: 40_000,
        cacheReusable: false,
      })

      // then
      expect(decision.choice).toBe("fresh")
      expect(decision.model).toBe("google/gemini-3.6-flash")
    })

    test("#when the session model is cheaper than the only registry candidate #then it inherits", () => {
      // when
      const decision = chooseReflectionLaunchModel({
        fresh: expensiveFresh,
        session: sessionHaiku,
        prefixTokens: 0,
        workloadTokens: 40_000,
        cacheReusable: false,
      })

      // then
      expect(decision.choice).toBe("inherit")
      expect(decision.model).toBe("anthropic/claude-haiku-4-5")
    })
  })

  describe("#given the launch can replay a cached prefix", () => {
    // Cache-reuse arithmetic: a large prefix billed at cacheRead can beat a cheaper model that
    // must pay full input price for the whole workload. Pinned so a future fork-mode launch
    // path inherits proven math rather than a guess.
    test("#when the cached prefix dominates #then inheriting the pricier session model wins", () => {
      // given: fresh = 200k * 0.3 = 60_000; inherit = 190k * 0.01 + 10k * 5 = 51_900
      const decision = chooseReflectionLaunchModel({
        fresh: cheapFresh,
        session: { model: "anthropic/claude-opus-5", cost: { input: 5, cacheRead: 0.01 } },
        prefixTokens: 190_000,
        workloadTokens: 200_000,
        cacheReusable: true,
      })

      // then
      expect(decision.choice).toBe("inherit")
    })

    test("#when the same inputs cannot reuse cache #then the cheap fresh model wins instead", () => {
      // when
      const decision = chooseReflectionLaunchModel({
        fresh: cheapFresh,
        session: { model: "anthropic/claude-opus-5", cost: { input: 5, cacheRead: 0.01 } },
        prefixTokens: 190_000,
        workloadTokens: 200_000,
        cacheReusable: false,
      })

      // then
      expect(decision.choice).toBe("fresh")
    })
  })

  describe("#given incomplete pricing data", () => {
    test("#when the fresh candidate has no cost data #then it still launches fresh deterministically", () => {
      // when
      const decision = chooseReflectionLaunchModel({
        fresh: { model: "local/mystery" },
        session: sessionHaiku,
        prefixTokens: 10_000,
        workloadTokens: 10_000,
        cacheReusable: false,
      })

      // then
      expect(decision.choice).toBe("fresh")
      expect(decision.reason).toBe("no_pricing")
    })

    test("#when only the session model exists #then it inherits", () => {
      // when
      const decision = chooseReflectionLaunchModel({
        session: sessionHaiku,
        prefixTokens: 10_000,
        workloadTokens: 10_000,
        cacheReusable: false,
      })

      // then
      expect(decision.choice).toBe("inherit")
    })
  })
})

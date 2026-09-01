import { describe, expect, test } from "bun:test"

import { chooseMemoryLaunchRoute, MEMORY_WORKLOAD_PROFILES } from "./fork-cost"

const KIMI = { input: 0.60, cacheRead: 0.15, output: 2.50 }
const LUNA = { input: 0.25, cacheRead: 0.025, output: 2.00 }
const OPUS = { input: 5.00, cacheRead: 0.50, output: 25.0 }
const PARENT_P50 = 156_872

describe("reflection launch route", () => {
  describe("#given a short job on a cheap-cache session model", () => {
    test("#when routed #then fork wins and carries the session model", () => {
      // when
      const route = chooseMemoryLaunchRoute({
        surface: "reflection",
        quick: { model: "kimi/kimi-for-coding-highspeed", cost: KIMI },
        session: { model: "openai/gpt-5.6-luna-fast", cost: LUNA },
        parentContextTokens: PARENT_P50,
        turns: MEMORY_WORKLOAD_PROFILES.reflection.turns,
        cacheHit: true,
      })

      // then
      expect(route.route).toBe("fork")
      expect(route.model).toBe("openai/gpt-5.6-luna-fast")
    })
  })

  describe("#given a long job on an expensive session model", () => {
    test("#when routed #then quick wins", () => {
      // when
      const route = chooseMemoryLaunchRoute({
        surface: "reflection",
        quick: { model: "kimi/kimi-for-coding-highspeed", cost: KIMI },
        session: { model: "anthropic/claude-opus-5", cost: OPUS },
        parentContextTokens: PARENT_P50,
        turns: MEMORY_WORKLOAD_PROFILES.reflection.turns,
        cacheHit: true,
      })

      // then
      expect(route.route).toBe("quick")
      expect(route.model).toBe("kimi/kimi-for-coding-highspeed")
    })
  })
})

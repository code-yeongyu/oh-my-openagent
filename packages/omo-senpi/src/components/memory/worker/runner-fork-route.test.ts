import { describe, expect, test } from "bun:test"

import { chooseMemoryLaunchRoute, MEMORY_WORKLOAD_PROFILES } from "./fork-cost"
import { memoryLaunchRouteInput, reflectionPayloadTokens } from "./runner-launch-route"

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

  describe("#given a parent session near its compaction threshold", () => {
    // The regression this guards: `--fork` seeds the child with the parent's whole context, so an
    // on_compaction reflection forked onto a 272k-window model overflows before the first turn.
    test("#when the runner assembles route inputs #then the near-full parent routes quick with window_unfit", () => {
      // given
      const registry = {
        getAvailable: () => [],
        find: (provider: string, id: string) =>
          provider === "openai" && id === "gpt-5.6-luna-fast"
            ? { provider, id, cost: LUNA, contextWindow: 272_000 }
            : provider === "kimi" && id === "kimi-for-coding-highspeed"
              ? { provider, id, cost: KIMI, contextWindow: 256_000 }
              : undefined,
      }

      // when
      const input = memoryLaunchRouteInput({
        surface: "reflection",
        quickModel: "kimi/kimi-for-coding-highspeed",
        registry,
        sessionModel: { provider: "openai", id: "gpt-5.6-luna-fast" },
        // 190k parent (the 0.70 compaction tier on 272k) + a full 128 KiB payload chunk (~32k tokens)
        // + injected prompt + 21 working turns lands above 0.8 * 272k, so fork must lose.
        parentContextTokens: 190_000,
        payloadTokens: 32_768,
        cacheHit: true,
      })
      const route = chooseMemoryLaunchRoute(input)

      // then
      expect(input.session?.contextWindow).toBe(272_000)
      expect(input.quick?.contextWindow).toBe(256_000)
      expect(route.route).toBe("quick")
      expect(route.reason).toBe("window_unfit")
      expect(route.model).toBe("kimi/kimi-for-coding-highspeed")
    })
  })
})

describe("reflectionPayloadTokens", () => {
  test("#given captured snapshots #when sized #then it is the serialized entry bytes over four", () => {
    // given
    const entries = [{ kind: "user", messageId: "user-1", text: "x".repeat(400) }]
    const bytes = Buffer.byteLength(JSON.stringify(entries), "utf8")

    // when / then
    expect(reflectionPayloadTokens([
      { conversationId: "conversation-a", snapshot: { entries } },
    ])).toBe(Math.ceil(bytes / 4))
    expect(reflectionPayloadTokens([])).toBe(0)
  })
})

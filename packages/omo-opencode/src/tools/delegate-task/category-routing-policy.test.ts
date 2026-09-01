import { describe, expect, test } from "bun:test"

import { DEFAULT_CATEGORIES } from "./constants"

describe("OpenCode task category routing policy", () => {
  test("uses the requested primary model and effort for routed categories", () => {
    // given / when
    const routing = {
      visualEngineering: DEFAULT_CATEGORIES["visual-engineering"],
      quick: DEFAULT_CATEGORIES["quick"],
      unspecifiedHigh: DEFAULT_CATEGORIES["unspecified-high"],
    }

    // then
    expect(routing).toEqual({
      visualEngineering: { model: "anthropic/claude-opus-5", variant: "max" },
      quick: { model: "kimi-for-coding/kimi-for-coding-highspeed" },
      unspecifiedHigh: { model: "anthropic/claude-opus-5", variant: "xhigh" },
    })
  })
})

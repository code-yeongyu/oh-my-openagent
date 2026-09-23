import { describe, expect, test } from "bun:test"
import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

import { AGENT_FALLBACK_CHAINS } from "./agents/builtin/fallback-chains"
import { CATEGORY_FALLBACK_CHAINS } from "./category/fallback-chains"

const DEEPSEEK_OFF = {
  providers: ["deepseek"],
  model: "deepseek-v4-flash",
  variant: "off",
} satisfies DelegateFallbackEntry

const DEEPSEEK_MAX = {
  providers: ["deepseek"],
  model: "deepseek-v4-flash",
  variant: "max",
} satisfies DelegateFallbackEntry

const KIMI_HIGHSPEED_OFF = {
  providers: ["kimi-coding", "kimi-for-coding"],
  model: "kimi-for-coding-highspeed",
  variant: "off",
} satisfies DelegateFallbackEntry

describe("Senpi Luna and DeepSeek chain policy", () => {
  test("quick leads with Luna low and places non-reasoning DeepSeek V4 Flash right after it", () => {
    const quick = CATEGORY_FALLBACK_CHAINS["quick"]

    expect(quick?.map((entry) => entry.model)).not.toContain("kimi-for-coding-highspeed")
    expect(quick?.slice(0, 2)).toEqual([
      { providers: ["chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" },
      DEEPSEEK_OFF,
    ])
  })

  test.each(["explore", "librarian"])(
    "%s leads with no-thinking Kimi HighSpeed, then Luna, then max-reasoning DeepSeek V4 Flash",
    (agentName) => {
      const chain = AGENT_FALLBACK_CHAINS[agentName]

      expect(chain?.slice(0, 3)).toEqual([
        KIMI_HIGHSPEED_OFF,
        { providers: ["chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" },
        DEEPSEEK_MAX,
      ])
    },
  )
})

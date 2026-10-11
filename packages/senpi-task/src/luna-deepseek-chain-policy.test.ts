import { describe, expect, test } from "bun:test"
import type { DelegateFallbackEntry } from "@oh-my-opencode/delegate-core"

import { AGENT_FALLBACK_CHAINS } from "./agents/builtin/fallback-chains"
import { CATEGORY_FALLBACK_CHAINS } from "./category/fallback-chains"

const DEEPSEEK_OFF = {
  providers: ["deepseek"],
  model: "deepseek-flash",
  variant: "off",
} satisfies DelegateFallbackEntry

const DEEPSEEK_MAX = {
  providers: ["deepseek"],
  model: "deepseek-flash",
  variant: "max",
} satisfies DelegateFallbackEntry

const KIMI_HIGHSPEED_OFF = {
  providers: ["kimi-coding", "kimi-for-coding"],
  model: "kimi-for-coding-highspeed",
  variant: "off",
} satisfies DelegateFallbackEntry

describe("Senpi Luna and DeepSeek chain policy", () => {
  test("quick leads with Luna low, Haiku 5.5 medium, then non-reasoning DeepSeek V4.1 Flash", () => {
    const quick = CATEGORY_FALLBACK_CHAINS["quick"]

    expect(quick?.map((entry) => entry.model)).not.toContain("kimi-for-coding-highspeed")
    expect(quick?.slice(0, 3)).toEqual([
      { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-luna-fast", variant: "low" },
      { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot"], model: "claude-haiku-5-5", variant: "medium" },
      DEEPSEEK_OFF,
    ])
  })

  test.each(["explore", "librarian"])(
    "%s leads with no-thinking Kimi HighSpeed, Luna, Haiku 5.5 medium, then max-reasoning DeepSeek V4.1 Flash",
    (agentName) => {
      const chain = AGENT_FALLBACK_CHAINS[agentName]

      expect(chain?.slice(0, 4)).toEqual([
        KIMI_HIGHSPEED_OFF,
        { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-luna-fast", variant: "low" },
        { providers: ["anthropic-subscription", "anthropic", "github-copilot"], model: "claude-haiku-5-5", variant: "medium" },
        DEEPSEEK_MAX,
      ])
    },
  )
})

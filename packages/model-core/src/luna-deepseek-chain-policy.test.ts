import { describe, expect, test } from "bun:test"

import { AGENT_MODEL_REQUIREMENTS, CATEGORY_MODEL_REQUIREMENTS } from "./model-requirements"
import type { FallbackEntry } from "./model-requirement-types"

const LUNA_LOW = {
  providers: ["openai", "chatgpt-subscription"],
  model: "gpt-6-luna-fast",
  variant: "low",
} satisfies FallbackEntry

const DEEPSEEK_OFF = {
  providers: ["deepseek"],
  model: "deepseek-flash",
  variant: "off",
} satisfies FallbackEntry

const DEEPSEEK_MAX = {
  providers: ["deepseek"],
  model: "deepseek-flash",
  variant: "max",
} satisfies FallbackEntry

const KIMI_HIGHSPEED_OFF = {
  providers: ["kimi-for-coding"],
  model: "kimi-for-coding-highspeed",
  variant: "off",
} satisfies FallbackEntry

describe("Luna and DeepSeek chain policy", () => {
  test("quick leads with Luna low, Haiku 5.5 medium, then non-reasoning DeepSeek V4.1 Flash", () => {
    const quick = CATEGORY_MODEL_REQUIREMENTS["quick"].fallbackChain

    expect(quick.map((entry) => entry.model)).not.toContain("kimi-for-coding-highspeed")
    expect(quick.slice(0, 3)).toEqual([
      LUNA_LOW,
      { providers: ["anthropic", "anthropic-api", "github-copilot"], model: "claude-haiku-5-5", variant: "medium" },
      DEEPSEEK_OFF,
    ])
  })

  test.each(["explore", "librarian"])(
    "%s leads with no-thinking Kimi HighSpeed, Luna, Haiku 5.5 medium, then max-reasoning DeepSeek V4.1 Flash",
    (agentName) => {
      const chain = AGENT_MODEL_REQUIREMENTS[agentName].fallbackChain

      expect(chain.slice(0, 4)).toEqual([
        KIMI_HIGHSPEED_OFF,
        { providers: ["openai", "chatgpt-subscription"], model: "gpt-6-luna-fast", variant: "low" },
        { providers: ["anthropic", "github-copilot"], model: "claude-haiku-5-5", variant: "medium" },
        DEEPSEEK_MAX,
      ])
    },
  )
})

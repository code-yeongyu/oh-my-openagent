import { describe, expect, test } from "bun:test"

import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"
import { DEFAULT_CATEGORIES } from "./index"

describe("Senpi category routing policy", () => {
  test("uses the requested primary model and effort for routed categories", () => {
    // given / when
    const routing = {
      visualEngineering: DEFAULT_CATEGORIES["visual-engineering"],
      quick: DEFAULT_CATEGORIES["quick"],
      unspecifiedHigh: DEFAULT_CATEGORIES["unspecified-high"],
      unspecifiedLow: DEFAULT_CATEGORIES["unspecified-low"],
    }

    // then
    expect(routing).toEqual({
      visualEngineering: { model: "anthropic/claude-opus-5", variant: "max" },
      quick: { model: "kimi-coding/kimi-for-coding-highspeed" },
      unspecifiedHigh: { model: "kimi-coding/k3", variant: "max" },
      unspecifiedLow: { model: "xai/grok-4.6", variant: "xhigh" },
    })
  })

  test("unspecified-low fallback chain is grok-4.6 xhigh first and excludes luna", () => {
    // given / when
    const chain = CATEGORY_FALLBACK_CHAINS["unspecified-low"]

    // then
    expect(chain.map((entry) => entry.model)).not.toContain("gpt-5.6-luna")
    expect(chain).toEqual([
      {
        providers: ["xai", "github-copilot", "opencode", "vercel"],
        model: "grok-4.6",
        variant: "xhigh",
      },
      {
        providers: ["openai", "quotio-openai", "github-copilot", "opencode", "vercel"],
        model: "gpt-5.6-terra",
        variant: "high",
      },
      {
        providers: ["anthropic", "anthropic-api", "github-copilot", "opencode", "vercel"],
        model: "claude-sonnet-5",
        variant: "low",
      },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"],
        model: "qwen3.8-max-preview",
        variant: "max",
      },
      {
        providers: ["deepseek", "opencode-go", "vercel"],
        model: "deepseek-v4-pro",
        variant: "max",
      },
      {
        providers: ["xiaomi", "opencode-go", "vercel"],
        model: "mimo-v2.5-pro",
        variant: "max",
      },
    ])
  })
})

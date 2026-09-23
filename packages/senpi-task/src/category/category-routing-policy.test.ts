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
      visualEngineering: { model: "anthropic/claude-fable-5-1", variant: "max" },
      quick: { model: "chatgpt-subscription/gpt-5.6-luna-fast", variant: "low" },
      unspecifiedHigh: { model: "anthropic/claude-opus-5-5", variant: "max" },
      unspecifiedLow: { model: "xiaomi/mimo-v2.6-pro", variant: "max" },
    })
  })

  test("unspecified-low fallback chain is mimo-v2.6-pro max first and excludes luna", () => {
    // given / when
    const chain = CATEGORY_FALLBACK_CHAINS["unspecified-low"]

    // then
    expect(chain.map((entry) => entry.model)).not.toContain("gpt-5.6-luna")
    expect(chain).toEqual([
      {
        providers: ["xiaomi", "opencode-go"],
        model: "mimo-v2.6-pro",
        variant: "max",
      },
      {
        providers: ["xai", "github-copilot", "opencode-go"],
        model: "grok-4.7",
        variant: "xhigh",
      },
      {
        providers: ["chatgpt-subscription", "github-copilot", "opencode"],
        model: "gpt-5.6-terra",
        variant: "high",
      },
      {
        providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"],
        model: "claude-sonnet-5",
        variant: "low",
      },
      {
        providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"],
        model: "qwen3.8-max-preview",
        variant: "max",
      },
      {
        providers: ["deepseek", "opencode-go"],
        model: "deepseek-v4-pro",
        variant: "max",
      },
      {
        providers: ["xiaomi", "opencode-go"],
        model: "mimo-v2.5-pro",
        variant: "max",
      }
    ])
  })
})

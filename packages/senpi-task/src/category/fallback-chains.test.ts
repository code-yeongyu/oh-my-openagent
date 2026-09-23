import { describe, expect, test } from "bun:test"

import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"

// Coupling guard: this test file must NEVER import @oh-my-opencode/model-core.
// packages/model-core/src/category-model-requirements.ts is the source of truth; this file is the
// independent transcription that catches drift between the two mirrors (senpi adds the kimi-coding
// provider id to kimi rungs, heads every claude-* rung with the anthropic-subscription subscription lane,
// lists chatgpt-subscription then openai on every GPT rung while model-core lists openai first, and ships
// the architect entry).

const CATEGORY_NAMES = [
  "visual-engineering",
  "architect",
  "ultrabrain",
  "deep-low",
  "deep-high",
  "artistry",
  "quick",
  "unspecified-low",
  "unspecified-high",
  "writing",
] as const

describe("CATEGORY_FALLBACK_CHAINS", () => {
  test("#given the builtin chains #when listing keys #then exactly the 10 category names are present", () => {
    expect(Object.keys(CATEGORY_FALLBACK_CHAINS).sort()).toEqual([...CATEGORY_NAMES].sort())
  })

  test("#given the mirrored fallback table #when compared with the independent transcription #then every provider model variant and order is pinned", () => {
    expect(CATEGORY_FALLBACK_CHAINS).toEqual({
      "visual-engineering": [
        { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "max" },
        { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5-5", variant: "max" },
        { providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"], model: "kimi-k3", variant: "max" },
      ],
      architect: [
        { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "max" }
      ],
      ultrabrain: [
        { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-astra", variant: "max" },
        { providers: ["github-copilot"], model: "gpt-6-astra", variant: "max" },
        { providers: ["chatgpt-subscription", "openai", "opencode"], model: "gpt-6-astra", variant: "max" },
        { providers: ["chatgpt-subscription", "openai"], model: "gpt-5.6-sol", variant: "max" },
        { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "max" },
        { providers: ["chatgpt-subscription", "openai", "opencode"], model: "gpt-5.6-sol", variant: "max" }
      ],
      "deep-low": [
        { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-sol-fast", variant: "medium" },
        { providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"], model: "gpt-6-sol", variant: "medium" }
      ],
      "deep-high": [
        { providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"], model: "gpt-6-astra", variant: "xhigh" }
      ],
      artistry: [
        { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "max" },
        { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5-5", variant: "max" },
        { providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"], model: "kimi-k3", variant: "max" }
      ],
      quick: [
        { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-luna-fast", variant: "low" },
        { providers: ["deepseek"], model: "deepseek-flash", variant: "off" },
        { providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"], model: "qwen3.6-flash", variant: "low" },
        { providers: ["opencode-go"], model: "minimax-m3", variant: "max" },
        { providers: ["opencode-go"], model: "minimax-m2.7", variant: "max" },
        { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
        { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot"], model: "claude-haiku-4-5", variant: "off" }
      ],
      "unspecified-low": [
        { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.6-pro", variant: "max" },
        { providers: ["xai", "github-copilot", "opencode-go"], model: "grok-4.7", variant: "xhigh" },
        { providers: ["chatgpt-subscription", "openai", "github-copilot", "opencode"], model: "gpt-5.6-terra", variant: "high" },
        { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-sonnet-5", variant: "low" },
        { providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"], model: "qwen3.8-max-preview", variant: "max" },
        { providers: ["deepseek", "opencode-go"], model: "deepseek-v4-pro", variant: "max" },
        { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.5-pro", variant: "max" }
      ],
      "unspecified-high": [
        { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5-5", variant: "medium" },
        { providers: ["zai-coding-plan", "opencode-go"], model: "glm-5.3", variant: "max" },
        { providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"], model: "kimi-k3", variant: "max" }
      ],
      writing: [
        { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "low" },
        { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5-5", variant: "low" },
        { providers: ["anthropic-subscription", "anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-4-6", variant: "max" }
      ]
    })
  })

  test("#given the builtin chains #when scanning providers #then no rung lists vercel or quotio-openai and only gpt-* rungs list the openai lane", () => {
    for (const name of CATEGORY_NAMES) {
      for (const entry of CATEGORY_FALLBACK_CHAINS[name] ?? []) {
        expect(entry.providers, `${name} rung ${entry.model} must not list vercel`).not.toContain("vercel")
        expect(entry.providers, `${name} rung ${entry.model} must not list quotio-openai`).not.toContain("quotio-openai")
        if (entry.model.startsWith("gpt-")) continue
        expect(entry.providers, `${name} rung ${entry.model} must not list the openai lane`).not.toContain("openai")
      }
    }
  })

  test("#given the builtin chains #when a rung serves a gpt-* model #then chatgpt-subscription leads and the openai lane follows it", () => {
    for (const name of CATEGORY_NAMES) {
      for (const entry of CATEGORY_FALLBACK_CHAINS[name] ?? []) {
        if (!entry.model.startsWith("gpt-") || entry.providers.every((provider) => provider === "github-copilot")) continue
        const subscription = entry.providers.indexOf("chatgpt-subscription")
        expect(subscription, `${name} rung ${entry.model} must route OpenAI through chatgpt-subscription`).toBeGreaterThanOrEqual(0)
        expect(
          entry.providers[subscription + 1],
          `${name} rung ${entry.model} must list the openai lane right after chatgpt-subscription (#8300, #8734)`,
        ).toBe("openai")
      }
    }
  })
})

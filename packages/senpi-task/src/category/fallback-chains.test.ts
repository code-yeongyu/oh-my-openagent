import { describe, expect, test } from "bun:test"

import { CATEGORY_FALLBACK_CHAINS } from "./fallback-chains"

// Coupling guard: this test file must NEVER import @oh-my-opencode/model-core.
// packages/model-core/src/category-model-requirements.ts is the source of truth; this file is the
// independent transcription that catches drift between the two mirrors (senpi adds the kimi-coding
// provider id to kimi rungs and ships the architect entry).

const CATEGORY_NAMES = [
  "visual-engineering",
  "architect",
  "ultrabrain",
  "deep",
  "artistry",
  "quick",
  "unspecified-low",
  "unspecified-high",
  "writing",
] as const

describe("CATEGORY_FALLBACK_CHAINS", () => {
  test("#given the builtin chains #when listing keys #then exactly the 9 category names are present", () => {
    expect(Object.keys(CATEGORY_FALLBACK_CHAINS).sort()).toEqual([...CATEGORY_NAMES].sort())
  })

  test("#given the mirrored fallback table #when compared with the independent transcription #then every provider model variant and order is pinned", () => {
    expect(CATEGORY_FALLBACK_CHAINS).toEqual({
      "visual-engineering": [
        { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5", variant: "max" },
        { providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"], model: "kimi-k3", variant: "max" },
        { providers: ["zai-coding-plan", "opencode-go"], model: "glm-5.2", variant: "max" },
        { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-5.6-sol", variant: "medium" }
      ],
      architect: [
        { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5", variant: "xhigh" }
      ],
      ultrabrain: [
        { providers: ["openai", "openai-codex"], model: "gpt-5.6-sol", variant: "max" },
        { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "max" },
        { providers: ["openai", "openai-codex", "opencode"], model: "gpt-5.6-sol", variant: "max" }
      ],
      deep: [
        { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-5.6-sol", variant: "medium" }
      ],
      artistry: [
        { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-fable-5", variant: "xhigh" },
        { providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"], model: "kimi-k3", variant: "max" },
        { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5", variant: "xhigh" }
      ],
      quick: [
        { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed" },
        { providers: ["openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
        { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "off" },
        { providers: ["qwen-token-plan", "alibaba-token-plan", "bailian-coding-plan"], model: "qwen3.6-flash", variant: "low" },
        { providers: ["opencode-go"], model: "minimax-m3", variant: "max" },
        { providers: ["opencode-go"], model: "minimax-m2.7", variant: "max" },
        { providers: ["xai"], model: "grok-4.20-0309-non-reasoning" },
        { providers: ["anthropic", "anthropic-api", "github-copilot"], model: "claude-haiku-4-5", variant: "off" }
      ],
      "unspecified-low": [
        { providers: ["xai", "github-copilot", "opencode"], model: "grok-4.6", variant: "xhigh" },
        { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-5.6-terra", variant: "high" },
        { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-sonnet-5", variant: "low" },
        { providers: ["qwen-token-plan", "alibaba-token-plan", "qwen-token-plan-cn", "alibaba-token-plan-cn"], model: "qwen3.8-max-preview", variant: "max" },
        { providers: ["deepseek", "opencode-go"], model: "deepseek-v4-pro", variant: "max" },
        { providers: ["xiaomi", "opencode-go"], model: "mimo-v2.5-pro", variant: "max" }
      ],
      "unspecified-high": [
        { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5", variant: "xhigh" },
        { providers: ["zai-coding-plan", "opencode-go"], model: "glm-5.3", variant: "max" },
        { providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"], model: "kimi-k3", variant: "max" }
      ],
      writing: [
        { providers: ["kimi-coding", "kimi-for-coding", "moonshotai", "opencode-go"], model: "kimi-k3", variant: "low" },
        { providers: ["anthropic", "anthropic-api", "github-copilot", "opencode"], model: "claude-opus-5", variant: "low" },
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3.1-pro" }
      ]
    })
  })

  test("#given the builtin chains #when scanning providers #then no rung lists vercel or quotio-openai", () => {
    for (const name of CATEGORY_NAMES) {
      for (const entry of CATEGORY_FALLBACK_CHAINS[name] ?? []) {
        expect(entry.providers, `${name} rung ${entry.model} must not list vercel`).not.toContain("vercel")
        expect(entry.providers, `${name} rung ${entry.model} must not list quotio-openai`).not.toContain("quotio-openai")
      }
    }
  })

  test("#given the builtin chains #when a rung lists openai #then openai-codex rides alongside", () => {
    for (const name of CATEGORY_NAMES) {
      for (const entry of CATEGORY_FALLBACK_CHAINS[name] ?? []) {
        if (entry.providers.includes("openai")) {
          expect(entry.providers, `${name} rung ${entry.model} lists openai without openai-codex`).toContain("openai-codex")
        }
      }
    }
  })
})

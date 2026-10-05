import { describe, expect, test } from "bun:test"

import { AGENT_FALLBACK_CHAINS } from "./fallback-chains"

// Coupling guard: this test file must NEVER import @oh-my-opencode/model-core.
// The chains are a hand transcription; the pins below catch transcription drift.

// The ulw reviewer agents resolve their model through `categories` (resolve-agent-categories.ts),
// so this table carries the 4 curated agents only.
const ALL_CHAIN_NAMES = ["explore", "librarian", "plan-consultant", "plan-reviewer"] as const

describe("AGENT_FALLBACK_CHAINS", () => {
  test("#given the builtin chains #when listing keys #then only the 4 curated agent names are present", () => {
    expect(Object.keys(AGENT_FALLBACK_CHAINS).sort()).toEqual([...ALL_CHAIN_NAMES])
  })

  test("#given the builtin chains #when inspecting entries #then every entry has a non-empty providers list and model", () => {
    for (const name of ALL_CHAIN_NAMES) {
      const chain = AGENT_FALLBACK_CHAINS[name]
      expect(chain).toBeDefined()
      expect(chain?.length).toBeGreaterThan(0)
      for (const entry of chain ?? []) {
        expect(entry.providers.length).toBeGreaterThan(0)
        expect(entry.model.length).toBeGreaterThan(0)
      }
    }
  })

  test("#given the builtin chains #when counting entries #then chain lengths match the source transcription", () => {
    const lengths = Object.fromEntries(
      ALL_CHAIN_NAMES.map((name) => [name, AGENT_FALLBACK_CHAINS[name]?.length]),
    )
    expect(lengths).toEqual({
      explore: 6,
      librarian: 6,
      "plan-consultant": 3,
      "plan-reviewer": 6,
    })
  })

  test("#given the mirrored fallback table #when compared with the independent transcription #then every provider model variant and order is pinned", () => {
    expect(AGENT_FALLBACK_CHAINS).toEqual({
      explore: [
        { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
        { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-luna-fast", variant: "low" },
        { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
        { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
        { providers: ["opencode-go"], model: "minimax-m2.7" },
        { providers: ["anthropic-subscription", "anthropic", "github-copilot"], model: "claude-haiku-4-5" }
      ],
      librarian: [
        { providers: ["kimi-coding", "kimi-for-coding"], model: "kimi-for-coding-highspeed", variant: "off" },
        { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-luna-fast", variant: "low" },
        { providers: ["deepseek"], model: "deepseek-flash", variant: "max" },
        { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
        { providers: ["opencode-go"], model: "minimax-m2.7" },
        { providers: ["anthropic-subscription", "anthropic", "github-copilot"], model: "claude-haiku-4-5" }
      ],
      "plan-consultant": [
        { providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "max" },
        { providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"], model: "claude-opus-5-5", variant: "max" },
        { providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"], model: "kimi-k3", variant: "max" }
      ],
      "plan-reviewer": [
        { providers: ["chatgpt-subscription", "openai"], model: "gpt-6-astra", variant: "xhigh" },
        { providers: ["github-copilot"], model: "gpt-6-astra", variant: "high" },
        { providers: ["chatgpt-subscription", "openai", "opencode"], model: "gpt-6-astra", variant: "high" },
        { providers: ["anthropic-subscription", "anthropic", "github-copilot", "opencode"], model: "claude-opus-5-5", variant: "max" },
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3.1-pro", variant: "high" },
        { providers: ["opencode-go"], model: "glm-5.2" }
      ]
    })
  })

  test("#given the builtin chains #when scanning providers #then no rung lists vercel or quotio-openai and only gpt-* rungs list the openai lane", () => {
    for (const name of ALL_CHAIN_NAMES) {
      for (const entry of AGENT_FALLBACK_CHAINS[name] ?? []) {
        expect(entry.providers, `${name} rung ${entry.model} must not list vercel`).not.toContain("vercel")
        expect(entry.providers, `${name} rung ${entry.model} must not list quotio-openai`).not.toContain("quotio-openai")
        if (entry.model.startsWith("gpt-")) continue
        expect(entry.providers, `${name} rung ${entry.model} must not list the openai lane`).not.toContain("openai")
      }
    }
  })

  test("#given the builtin chains #when a rung serves a gpt-* model #then chatgpt-subscription leads and the openai lane follows it", () => {
    for (const name of ALL_CHAIN_NAMES) {
      for (const entry of AGENT_FALLBACK_CHAINS[name] ?? []) {
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

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
      explore: 8,
      librarian: 8,
      "plan-consultant": 3,
      "plan-reviewer": 6,
    })
  })

  test("#given the mirrored fallback table #when compared with the independent transcription #then every provider model variant and order is pinned", () => {
    expect(AGENT_FALLBACK_CHAINS).toEqual({
      explore: [
        { providers: ["openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
        { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
        { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
        { providers: ["opencode-go"], model: "minimax-m3" },
        { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
        { providers: ["opencode-go"], model: "minimax-m2.7" },
        { providers: ["claude-sdk-oauth", "anthropic", "github-copilot"], model: "claude-haiku-4-5" },
        { providers: ["openai-codex"], model: "gpt-5.4-nano" }
      ],
      librarian: [
        { providers: ["openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
        { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
        { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.7-plus" },
        { providers: ["opencode-go"], model: "minimax-m3" },
        { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
        { providers: ["opencode-go"], model: "minimax-m2.7" },
        { providers: ["claude-sdk-oauth", "anthropic", "github-copilot"], model: "claude-haiku-4-5" },
        { providers: ["openai-codex"], model: "gpt-5.4-nano" }
      ],
      "plan-consultant": [
        { providers: ["claude-sdk-oauth", "anthropic", "github-copilot", "opencode"], model: "claude-fable-5-1", variant: "max" },
        { providers: ["claude-sdk-oauth", "anthropic", "github-copilot", "opencode"], model: "claude-opus-5", variant: "max" },
        { providers: ["opencode-go", "kimi-for-coding", "moonshotai", "opencode"], model: "kimi-k3", variant: "max" }
      ],
      "plan-reviewer": [
        { providers: ["openai-codex"], model: "gpt-6-astra", variant: "xhigh" },
        { providers: ["github-copilot"], model: "gpt-6-astra", variant: "high" },
        { providers: ["openai-codex", "opencode"], model: "gpt-6-astra", variant: "high" },
        { providers: ["claude-sdk-oauth", "anthropic", "github-copilot", "opencode"], model: "claude-opus-5", variant: "max" },
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3.1-pro", variant: "high" },
        { providers: ["opencode-go"], model: "glm-5.2" }
      ]
    })
  })

  test("#given the builtin chains #when scanning providers #then no rung lists vercel, quotio-openai, or the openai API lane", () => {
    for (const name of ALL_CHAIN_NAMES) {
      for (const entry of AGENT_FALLBACK_CHAINS[name] ?? []) {
        expect(entry.providers, `${name} rung ${entry.model} must not list vercel`).not.toContain("vercel")
        expect(entry.providers, `${name} rung ${entry.model} must not list quotio-openai`).not.toContain("quotio-openai")
        expect(entry.providers, `${name} rung ${entry.model} must not list the openai API lane`).not.toContain("openai")
      }
    }
  })

  test("#given the builtin chains #when a rung serves a gpt-* model #then openai-codex is its OpenAI lane", () => {
    for (const name of ALL_CHAIN_NAMES) {
      for (const entry of AGENT_FALLBACK_CHAINS[name] ?? []) {
        if (!entry.model.startsWith("gpt-") || entry.providers.every((provider) => provider === "github-copilot")) continue
        expect(entry.providers, `${name} rung ${entry.model} must route OpenAI through openai-codex`).toContain("openai-codex")
      }
    }
  })
})

import { describe, expect, test } from "bun:test"

import { AGENT_FALLBACK_CHAINS } from "./fallback-chains"

// Coupling guard: this test file must NEVER import @oh-my-opencode/model-core.
// The chains are a hand transcription; the pins below catch transcription drift.

// The ulw reviewer agents resolve their model through `categories` (resolve-agent-categories.ts),
// so this table carries the 4 curated agents only.
const ALL_CHAIN_NAMES = ["explore", "librarian", "metis", "momus"] as const

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
      metis: 5,
      momus: 7,
    })
  })

  test("#given the mirrored fallback table #when compared with the independent transcription #then every provider model variant and order is pinned", () => {
    expect(AGENT_FALLBACK_CHAINS).toEqual({
      explore: [
        { providers: ["openai", "openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
        { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
        { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
        { providers: ["opencode-go"], model: "minimax-m3" },
        { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
        { providers: ["opencode-go"], model: "minimax-m2.7" },
        { providers: ["anthropic", "github-copilot"], model: "claude-haiku-4-5" },
        { providers: ["openai", "openai-codex"], model: "gpt-5.4-nano" }
      ],
      librarian: [
        { providers: ["openai", "openai-codex"], model: "gpt-5.6-luna-fast", variant: "low" },
        { providers: ["deepseek"], model: "deepseek-v4-flash", variant: "max" },
        { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
        { providers: ["opencode-go"], model: "minimax-m3" },
        { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
        { providers: ["opencode-go"], model: "minimax-m2.7" },
        { providers: ["anthropic", "github-copilot"], model: "claude-haiku-4-5" },
        { providers: ["openai", "openai-codex"], model: "gpt-5.4-nano" }
      ],
      metis: [
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-sonnet-4-6" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-5", variant: "max" },
        { providers: ["openai", "openai-codex", "github-copilot", "opencode"], model: "gpt-5.6-sol", variant: "medium" },
        { providers: ["opencode-go"], model: "glm-5.2" },
        { providers: ["kimi-for-coding"], model: "kimi-k3" }
      ],
      momus: [
        { providers: ["openai", "openai-codex"], model: "gpt-5.6-terra", variant: "high" },
        { providers: ["github-copilot"], model: "gpt-5.6-terra", variant: "high" },
        { providers: ["openai", "openai-codex", "opencode"], model: "gpt-5.6-sol", variant: "xhigh" },
        { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "high" },
        { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-5", variant: "max" },
        { providers: ["google", "github-copilot", "opencode"], model: "gemini-3.1-pro", variant: "high" },
        { providers: ["opencode-go"], model: "glm-5.2" }
      ]
    })
  })

  test("#given the builtin chains #when scanning providers #then no rung lists vercel or quotio-openai", () => {
    for (const name of ALL_CHAIN_NAMES) {
      for (const entry of AGENT_FALLBACK_CHAINS[name] ?? []) {
        expect(entry.providers, `${name} rung ${entry.model} must not list vercel`).not.toContain("vercel")
        expect(entry.providers, `${name} rung ${entry.model} must not list quotio-openai`).not.toContain("quotio-openai")
      }
    }
  })

  test("#given the builtin chains #when a rung lists openai #then openai-codex rides alongside", () => {
    for (const name of ALL_CHAIN_NAMES) {
      for (const entry of AGENT_FALLBACK_CHAINS[name] ?? []) {
        if (entry.providers.includes("openai")) {
          expect(entry.providers, `${name} rung ${entry.model} lists openai without openai-codex`).toContain("openai-codex")
        }
      }
    }
  })
})

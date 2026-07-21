import { describe, expect, test } from "bun:test"

import { AGENT_FALLBACK_CHAINS } from "./fallback-chains"

// Coupling guard: this test file must NEVER import @oh-my-opencode/model-core.
// The chains are a hand transcription; the pins below catch transcription drift.

const CURATED_AGENT_NAMES = ["explore", "librarian", "metis", "momus", "oracle"] as const

describe("AGENT_FALLBACK_CHAINS", () => {
  test("#given the builtin chains #when listing keys #then exactly the 5 curated agent names are present", () => {
    expect(Object.keys(AGENT_FALLBACK_CHAINS).sort()).toEqual([...CURATED_AGENT_NAMES])
  })

  test("#given the builtin chains #when inspecting entries #then every entry has a non-empty providers list and model", () => {
    for (const name of CURATED_AGENT_NAMES) {
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
      CURATED_AGENT_NAMES.map((name) => [name, AGENT_FALLBACK_CHAINS[name]?.length]),
    )
    expect(lengths).toEqual({
      explore: 8,
      librarian: 8,
      metis: 5,
      momus: 6,
      oracle: 5,
    })
  })

  test("#given the oracle chain #when reading the head entry #then it is the literal transcribed gpt-5.6-sol xhigh rung", () => {
    expect(AGENT_FALLBACK_CHAINS.oracle?.[0]).toEqual({
      providers: ["openai", "opencode", "vercel"],
      model: "gpt-5.6-sol",
      variant: "xhigh",
    })
    expect(AGENT_FALLBACK_CHAINS.oracle?.[1]).toEqual({
      providers: ["github-copilot"],
      model: "gpt-5.6-sol",
      variant: "high",
    })
  })

  test("#given the mirrored fallback table #when compared with the independent transcription #then every provider model variant and order is pinned", () => {
    expect(AGENT_FALLBACK_CHAINS).toEqual({
      explore: [
        { providers: ["openai"], model: "gpt-5.4-mini-fast" },
        { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
        { providers: ["vercel"], model: "minimax-m2.7-highspeed" },
        { providers: ["opencode-go", "vercel"], model: "minimax-m3" },
        { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
        { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
        { providers: ["anthropic", "github-copilot", "vercel"], model: "claude-haiku-4-5" },
        { providers: ["openai", "vercel"], model: "gpt-5.4-nano" },
      ],
      librarian: [
        { providers: ["openai"], model: "gpt-5.4-mini-fast" },
        { providers: ["opencode-go", "bailian-coding-plan"], model: "qwen3.5-plus" },
        { providers: ["vercel"], model: "minimax-m2.7-highspeed" },
        { providers: ["opencode-go", "vercel"], model: "minimax-m3" },
        { providers: ["minimax-coding-plan", "minimax-cn-coding-plan"], model: "MiniMax-M3" },
        { providers: ["opencode-go", "vercel"], model: "minimax-m2.7" },
        { providers: ["anthropic", "github-copilot", "vercel"], model: "claude-haiku-4-5" },
        { providers: ["openai", "vercel"], model: "gpt-5.4-nano" },
      ],
      metis: [
        { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-sonnet-4-6" },
        { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-opus-4-8", variant: "max" },
        { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5", variant: "high" },
        { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
        { providers: ["kimi-for-coding"], model: "kimi-k3" },
      ],
      momus: [
        { providers: ["openai", "vercel"], model: "gpt-5.6-terra", variant: "high" },
        { providers: ["github-copilot"], model: "gpt-5.6-terra", variant: "high" },
        { providers: ["openai", "github-copilot", "opencode", "vercel"], model: "gpt-5.5", variant: "xhigh" },
        { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-opus-4-8", variant: "max" },
        { providers: ["google", "github-copilot", "opencode", "vercel"], model: "gemini-3.1-pro", variant: "high" },
        { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
      ],
      oracle: [
        { providers: ["openai", "opencode", "vercel"], model: "gpt-5.6-sol", variant: "xhigh" },
        { providers: ["github-copilot"], model: "gpt-5.6-sol", variant: "high" },
        { providers: ["google", "github-copilot", "opencode", "vercel"], model: "gemini-3.1-pro", variant: "high" },
        { providers: ["anthropic", "github-copilot", "opencode", "vercel"], model: "claude-opus-4-8", variant: "max" },
        { providers: ["opencode-go", "vercel"], model: "glm-5.2" },
      ],
    })
  })
})

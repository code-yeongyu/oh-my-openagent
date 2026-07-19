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
      oracle: 4,
    })
  })

  test("#given the oracle chain #when reading the head entry #then it is the literal transcribed gpt-5.5 high rung", () => {
    expect(AGENT_FALLBACK_CHAINS.oracle?.[0]).toEqual({
      providers: ["openai", "github-copilot", "opencode", "vercel"],
      model: "gpt-5.5",
      variant: "high",
    })
  })
})

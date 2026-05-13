/// <reference types="bun-types" />

import { describe, expect, test, mock } from "bun:test"

// Mock logger before any imports that might pull it in transitively.
mock.module("../../../shared/logger", () => ({ log: () => {} }))

import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
} from "../../../shared/model-requirements"
import {
  filterReachableChainEntries,
  pickEntryProvider,
} from "./member-selection-policy"

const DISABLED_SET = ["github-copilot", "vercel", "anthropic", "zen"] as const
const disabledLower = new Set(DISABLED_SET.map((p) => p.toLowerCase()))

// ---------------------------------------------------------------------------
// Scenario A — no disabledProviders param: behaviour must be identical to today
// ---------------------------------------------------------------------------

describe("Scenario A — regression: no disabledProviders → identical to existing behaviour", () => {
  test("#given null connectedProviders, no disabledProviders #then filterReachableChainEntries returns full chain", () => {
    const chain = AGENT_MODEL_REQUIREMENTS["sisyphus"]!.fallbackChain
    expect(filterReachableChainEntries(chain, null)).toEqual([...chain])
  })

  test("#given null connectedProviders, no disabledProviders #then pickEntryProvider picks providers[0]", () => {
    const chain = AGENT_MODEL_REQUIREMENTS["sisyphus"]!.fallbackChain
    for (const entry of chain) {
      if (entry.providers.length === 0) continue
      expect(pickEntryProvider({ entry, connectedProviders: null })).toBe(entry.providers[0])
    }
  })

  test("#given connected providers present, no disabledProviders #then warm-cache filter unchanged", () => {
    const chain = AGENT_MODEL_REQUIREMENTS["sisyphus-junior"]!.fallbackChain
    // connect only "openai" — only first entry survives
    const result = filterReachableChainEntries(chain, ["openai"])
    expect(result.every((e) => e.providers.includes("openai"))).toBe(true)
    // entries without openai are excluded
    const excluded = chain.filter((e) => !e.providers.includes("openai"))
    for (const e of excluded) {
      expect(result).not.toContain(e)
    }
  })

  test("#given warm cache, no disabledProviders #then pickEntryProvider prefers connected provider", () => {
    const entry = AGENT_MODEL_REQUIREMENTS["sisyphus"]!.fallbackChain[0]! // ["anthropic","github-copilot","opencode","vercel"]
    // only "opencode" connected
    expect(pickEntryProvider({ entry, connectedProviders: ["opencode"] })).toBe("opencode")
  })

  test("#given warm cache, no match, no disabledProviders #then pickEntryProvider returns first provider", () => {
    const entry = AGENT_MODEL_REQUIREMENTS["sisyphus"]!.fallbackChain[0]! // providers[0]="anthropic"
    expect(pickEntryProvider({ entry, connectedProviders: ["unrelated-provider"] })).toBe("anthropic")
  })
})

// ---------------------------------------------------------------------------
// Scenario B — cold cache + DISABLED_SET: zero leaks across all 90 chain entries
// ---------------------------------------------------------------------------

describe("Scenario B — cold cache + disabled=DISABLED_SET: no pick lands in disabled set", () => {
  // Count leaks before (simulating current behaviour: cold cache → providers[0])
  // and after (new behaviour) to verify the 20 → 0 improvement.
  test("#audit before vs after: 20 leaks → 0 leaks", () => {
    let beforeLeaks = 0
    let afterLeaks = 0

    const allReqs = [
      ...Object.values(AGENT_MODEL_REQUIREMENTS),
      ...Object.values(CATEGORY_MODEL_REQUIREMENTS),
    ]

    for (const req of allReqs) {
      for (const entry of req.fallbackChain) {
        // Current (before): cold cache always picks providers[0]
        const beforeProvider = entry.providers[0]
        if (beforeProvider && disabledLower.has(beforeProvider.toLowerCase())) {
          beforeLeaks++
        }

        // New (after): picks first non-disabled
        const afterProvider = pickEntryProvider({
          entry,
          connectedProviders: null,
          disabledProviders: DISABLED_SET,
        })
        if (afterProvider && disabledLower.has(afterProvider.toLowerCase())) {
          afterLeaks++
        }
      }
    }

    expect(beforeLeaks).toBe(20)
    expect(afterLeaks).toBe(0)
  })

  describe("AGENT_MODEL_REQUIREMENTS — per-agent cold-cache assertions", () => {
    for (const [agentName, req] of Object.entries(AGENT_MODEL_REQUIREMENTS)) {
      test(`agent=${agentName}: no provider picked from disabled set (cold cache)`, () => {
        for (const entry of req.fallbackChain) {
          const provider = pickEntryProvider({
            entry,
            connectedProviders: null,
            disabledProviders: DISABLED_SET,
          })
          if (provider !== undefined) {
            expect(disabledLower.has(provider.toLowerCase())).toBe(false)
          }
        }
      })

      test(`agent=${agentName}: filterReachableChainEntries keeps at least one entry (cold cache)`, () => {
        const reachable = filterReachableChainEntries(req.fallbackChain, null, DISABLED_SET)
        // At least one chain entry must survive — otherwise creative mode would
        // hard-error, which is a separate problem worth catching here.
        expect(reachable.length).toBeGreaterThan(0)
      })
    }
  })

  describe("CATEGORY_MODEL_REQUIREMENTS — per-category cold-cache assertions", () => {
    for (const [categoryName, req] of Object.entries(CATEGORY_MODEL_REQUIREMENTS)) {
      test(`category=${categoryName}: no provider picked from disabled set (cold cache)`, () => {
        for (const entry of req.fallbackChain) {
          const provider = pickEntryProvider({
            entry,
            connectedProviders: null,
            disabledProviders: DISABLED_SET,
          })
          if (provider !== undefined) {
            expect(disabledLower.has(provider.toLowerCase())).toBe(false)
          }
        }
      })
    }
  })
})

// ---------------------------------------------------------------------------
// Scenario C — all providers of an entry are disabled
// ---------------------------------------------------------------------------

describe("Scenario C — all-disabled-providers entry", () => {
  const allDisabledEntry = {
    providers: ["anthropic", "github-copilot", "vercel", "zen"],
    model: "all-disabled-model",
  }
  const partialEntry = { providers: ["opencode-go", "vercel"], model: "kimi-k2.6" }
  const chain = [allDisabledEntry, partialEntry]

  test("#given entry where every provider is disabled #then filterReachableChainEntries excludes it (cold cache)", () => {
    const result = filterReachableChainEntries(chain, null, DISABLED_SET)
    expect(result.map((e) => e.model)).not.toContain("all-disabled-model")
    expect(result.map((e) => e.model)).toContain("kimi-k2.6")
  })

  test("#given entry where every provider is disabled #then filterReachableChainEntries excludes it (warm cache)", () => {
    // Connect anthropic (disabled) — entry should still be excluded.
    const result = filterReachableChainEntries(chain, ["anthropic", "opencode-go"], DISABLED_SET)
    expect(result.map((e) => e.model)).not.toContain("all-disabled-model")
  })

  test("#given entry where every provider is disabled #then pickEntryProvider returns undefined (cold cache)", () => {
    expect(
      pickEntryProvider({ entry: allDisabledEntry, connectedProviders: null, disabledProviders: DISABLED_SET }),
    ).toBeUndefined()
  })

  test("#given entry where every provider is disabled #then pickEntryProvider returns undefined (warm cache)", () => {
    // Even if anthropic is connected, it's still disabled → undefined.
    expect(
      pickEntryProvider({ entry: allDisabledEntry, connectedProviders: ["anthropic"], disabledProviders: DISABLED_SET }),
    ).toBeUndefined()
  })

  test("#given entry with mixed disabled/allowed providers #then pickEntryProvider skips disabled ones", () => {
    const mixed = { providers: ["anthropic", "opencode-go", "vercel"], model: "mixed" }
    const provider = pickEntryProvider({ entry: mixed, connectedProviders: null, disabledProviders: DISABLED_SET })
    expect(provider).toBe("opencode-go")
    expect(disabledLower.has(provider!.toLowerCase())).toBe(false)
  })
})

/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"

import type { FallbackEntry } from "../../../shared/model-requirements"
import type { TeamModeConfig } from "../../../config/schema/team-mode"
import type { TeamSpec } from "../types"
import {
  fallbackEntryToModelConfig,
  filterReachableChainEntries,
  pickCreativeChainEntry,
  pickEntryProvider,
  resolveMemberSelectionMode,
  TEAM_MEMBER_MODEL_INTENT,
} from "./member-selection-policy"

const stubChain: FallbackEntry[] = [
  { providers: ["anthropic", "github-copilot"], model: "claude-opus-4-7", variant: "max" },
  { providers: ["opencode-go", "vercel"], model: "kimi-k2.6" },
  { providers: ["openai", "github-copilot"], model: "gpt-5.5", variant: "medium" },
]

function makeSpec(member_selection: TeamSpec["member_selection"] = undefined): Pick<TeamSpec, "member_selection"> {
  return { member_selection }
}

function makeConfig(member_selection: TeamModeConfig["member_selection"] = "stable"): Pick<TeamModeConfig, "member_selection"> {
  return { member_selection }
}

describe("resolveMemberSelectionMode — precedence", () => {
  test("#given call arg present #then call arg wins over spec and config", () => {
    expect(resolveMemberSelectionMode({
      callArg: "creative",
      spec: makeSpec("stable"),
      config: makeConfig("stable"),
    })).toBe("creative")
  })

  test("#given no call arg, spec set #then spec wins over config", () => {
    expect(resolveMemberSelectionMode({
      spec: makeSpec("creative"),
      config: makeConfig("stable"),
    })).toBe("creative")
  })

  test("#given neither call arg nor spec #then config wins", () => {
    expect(resolveMemberSelectionMode({
      spec: makeSpec(),
      config: makeConfig("creative"),
    })).toBe("creative")
  })

  test("#given config default 'stable' #then default wins through every layer", () => {
    expect(resolveMemberSelectionMode({
      spec: makeSpec(),
      config: makeConfig("stable"),
    })).toBe("stable")
  })
})

describe("filterReachableChainEntries", () => {
  test("#given null connectedProviders #then returns whole chain (cold-cache parity)", () => {
    expect(filterReachableChainEntries(stubChain, null)).toEqual(stubChain)
  })

  test("#given some providers connected #then only entries with at least one connected provider survive", () => {
    const result = filterReachableChainEntries(stubChain, ["opencode-go"])
    expect(result.map((entry) => entry.model)).toEqual(["kimi-k2.6"])
  })

  test("#given case-insensitive match #then provider names normalize to lowercase", () => {
    const result = filterReachableChainEntries(stubChain, ["ANTHROPIC"])
    expect(result.map((entry) => entry.model)).toEqual(["claude-opus-4-7"])
  })

  test("#given no providers connected #then returns empty array", () => {
    expect(filterReachableChainEntries(stubChain, [])).toEqual([])
  })
})

describe("pickCreativeChainEntry — round-robin", () => {
  test("#given index < length #then returns entry at index", () => {
    expect(pickCreativeChainEntry(stubChain, 0)?.model).toBe("claude-opus-4-7")
    expect(pickCreativeChainEntry(stubChain, 1)?.model).toBe("kimi-k2.6")
    expect(pickCreativeChainEntry(stubChain, 2)?.model).toBe("gpt-5.5")
  })

  test("#given index >= length #then wraps via modulo (round-robin)", () => {
    expect(pickCreativeChainEntry(stubChain, 3)?.model).toBe("claude-opus-4-7")
    expect(pickCreativeChainEntry(stubChain, 4)?.model).toBe("kimi-k2.6")
    expect(pickCreativeChainEntry(stubChain, 7)?.model).toBe("kimi-k2.6")
  })

  test("#given empty chain #then returns undefined (caller surfaces clear error)", () => {
    expect(pickCreativeChainEntry([], 0)).toBeUndefined()
    expect(pickCreativeChainEntry([], 5)).toBeUndefined()
  })

  test("#given negative index #then returns undefined", () => {
    expect(pickCreativeChainEntry(stubChain, -1)).toBeUndefined()
  })
})

describe("fallbackEntryToModelConfig", () => {
  test("#given entry with all tuning fields #then maps every field", () => {
    const entry: FallbackEntry = {
      providers: ["anthropic"],
      model: "claude-opus-4-7",
      variant: "max",
      reasoningEffort: "medium",
      temperature: 0.7,
      top_p: 0.95,
      maxTokens: 4096,
      thinking: { type: "enabled", budgetTokens: 2048 },
    }

    expect(fallbackEntryToModelConfig({ entry, providerID: "anthropic" })).toEqual({
      providerID: "anthropic",
      modelID: "claude-opus-4-7",
      variant: "max",
      reasoningEffort: "medium",
      temperature: 0.7,
      top_p: 0.95,
      maxTokens: 4096,
      thinking: { type: "enabled", budgetTokens: 2048 },
    })
  })

  test("#given entry with no tuning #then returns minimal config", () => {
    const entry: FallbackEntry = { providers: ["opencode-go"], model: "kimi-k2.6" }
    expect(fallbackEntryToModelConfig({ entry, providerID: "opencode-go" })).toEqual({
      providerID: "opencode-go",
      modelID: "kimi-k2.6",
    })
  })
})

describe("pickEntryProvider", () => {
  test("#given null cache #then picks first provider", () => {
    const entry: FallbackEntry = { providers: ["anthropic", "github-copilot"], model: "claude-opus-4-7" }
    expect(pickEntryProvider({ entry, connectedProviders: null })).toBe("anthropic")
  })

  test("#given cache lacks first provider #then picks first connected provider", () => {
    const entry: FallbackEntry = { providers: ["anthropic", "github-copilot"], model: "claude-opus-4-7" }
    expect(pickEntryProvider({ entry, connectedProviders: ["github-copilot"] })).toBe("github-copilot")
  })

  test("#given no providers connected #then falls back to entry's first provider", () => {
    const entry: FallbackEntry = { providers: ["anthropic", "github-copilot"], model: "claude-opus-4-7" }
    expect(pickEntryProvider({ entry, connectedProviders: ["unrelated"] })).toBe("anthropic")
  })

  test("#given empty providers list #then returns undefined", () => {
    const entry: FallbackEntry = { providers: [], model: "ghost" }
    expect(pickEntryProvider({ entry, connectedProviders: null })).toBeUndefined()
  })
})

describe("TEAM_MEMBER_MODEL_INTENT", () => {
  test("is the explicit constant — every team-mode launch path tags this", () => {
    expect(TEAM_MEMBER_MODEL_INTENT).toBe("explicit")
  })
})

import { describe, expect, test } from "bun:test"
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
  type FallbackEntry,
  type ModelRequirement,
} from "./model-requirements"

function flattenChains(): FallbackEntry[] {
  return [
    ...Object.values(AGENT_MODEL_REQUIREMENTS).flatMap((r) => r.fallbackChain),
    ...Object.values(CATEGORY_MODEL_REQUIREMENTS).flatMap((r) => r.fallbackChain),
  ]
}

function assertNoExcludedModels(entry: FallbackEntry): void {
  // User exclusions.
  expect(entry.model).not.toBe("grok-code-fast-1")
  if (entry.providers.includes("quotio")) {
    expect(entry.model).not.toBe("tstars2.0")
    expect(entry.model).not.toMatch(/^kiro-/i)
    expect(entry.model).not.toMatch(/^tab_/i)
  }
  // Remove codex-mini models per request.
  expect(entry.model).not.toMatch(/codex-mini/i)
}

function assertNoOpencodeProvider(entry: FallbackEntry): void {
  expect(entry.providers).not.toContain("opencode")
}

function assertNoProviderPrefixForNonNamespacedProviders(entry: FallbackEntry): void {
  // For these providers, model IDs should not be written as "provider/model".
  const nonNamespaced = ["quotio", "openai", "github-copilot", "minimax", "minimax-coding-plan"]
  for (const provider of entry.providers) {
    if (!nonNamespaced.includes(provider)) continue
    expect(entry.model.startsWith(`${provider}/`)).toBe(false)
  }
}

describe("AGENT_MODEL_REQUIREMENTS", () => {
  test("defines all 10 builtin agents", () => {
    expect(Object.keys(AGENT_MODEL_REQUIREMENTS).sort()).toEqual([
      "atlas",
      "explore",
      "hephaestus",
      "librarian",
      "metis",
      "momus",
      "multimodal-looker",
      "oracle",
      "prometheus",
      "sisyphus",
    ])
  })

  test("sisyphus: 2nd fallback is quotio gpt-5.3-codex (high)", () => {
    const sisyphus = AGENT_MODEL_REQUIREMENTS["sisyphus"]
    expect(sisyphus.requiresAnyModel).toBe(true)
    expect(sisyphus.fallbackChain.length).toBeGreaterThan(2)

    expect(sisyphus.fallbackChain[0]).toEqual({
      providers: ["quotio"],
      model: "claude-opus-4-6",
      variant: "max",
    })

    expect(sisyphus.fallbackChain[1]).toEqual({
      providers: ["quotio"],
      model: "gpt-5.3-codex",
      variant: "high",
    })
  })

  test("explore: uses speed chain, includes rome, and gpt-5-mini is copilot-first", () => {
    const explore = AGENT_MODEL_REQUIREMENTS["explore"]
    expect(explore.fallbackChain.length).toBeGreaterThan(4)
    expect(explore.fallbackChain[0].model).toBe("claude-haiku-4-5")
    expect(explore.fallbackChain.some((e) => e.model === "iflow-rome-30ba3b")).toBe(true)

    const gptMini = explore.fallbackChain.find((e) => e.model === "gpt-5-mini")
    expect(gptMini).toBeDefined()
    expect(gptMini!.providers[0]).toBe("github-copilot")
    expect(gptMini!.variant).toBe("high")
  })

  test("multimodal-looker: prefers gemini image model first", () => {
    const multimodal = AGENT_MODEL_REQUIREMENTS["multimodal-looker"]
    expect(multimodal.fallbackChain[0]).toEqual({
      providers: ["quotio"],
      model: "gemini-3-pro-image",
    })
  })

  test("includes NVIDIA NIM additions in at least one agent chain", () => {
    const all = Object.values(AGENT_MODEL_REQUIREMENTS).flatMap((r) => r.fallbackChain)
    expect(all.some((e) => e.providers.includes("nvidia") && e.model === "qwen/qwen3.5-397b-a17b")).toBe(true)
    expect(all.some((e) => e.providers.includes("nvidia") && e.model === "stepfun-ai/step-3.5-flash")).toBe(true)
    expect(all.some((e) => e.providers.includes("nvidia") && e.model === "bytedance/seed-oss-36b-instruct")).toBe(true)
  })
})

describe("CATEGORY_MODEL_REQUIREMENTS", () => {
  test("defines all 8 categories", () => {
    expect(Object.keys(CATEGORY_MODEL_REQUIREMENTS).sort()).toEqual([
      "artistry",
      "deep",
      "quick",
      "ultrabrain",
      "unspecified-high",
      "unspecified-low",
      "visual-engineering",
      "writing",
    ])
  })

  test("deep requires gpt-5.3-codex", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["deep"].requiresModel).toBe("gpt-5.3-codex")
  })

  test("quick uses the speed chain (haiku primary)", () => {
    expect(CATEGORY_MODEL_REQUIREMENTS["quick"].fallbackChain[0].model).toBe("claude-haiku-4-5")
  })

  test("ultrabrain starts with gpt-5.3-codex (high)", () => {
    const ultrabrain = CATEGORY_MODEL_REQUIREMENTS["ultrabrain"]
    expect(ultrabrain.fallbackChain[0]).toEqual({
      providers: ["quotio"],
      model: "gpt-5.3-codex",
      variant: "high",
    })
  })
})

describe("ModelRequirements invariants", () => {
  test("all entries have non-empty providers and a non-empty model", () => {
    for (const entry of flattenChains()) {
      expect(entry.providers.length).toBeGreaterThan(0)
      expect(typeof entry.model).toBe("string")
      expect(entry.model.length).toBeGreaterThan(0)
    }
  })

  test("no entry uses opencode provider and no excluded models are present", () => {
    for (const entry of flattenChains()) {
      assertNoOpencodeProvider(entry)
      assertNoExcludedModels(entry)
      assertNoProviderPrefixForNonNamespacedProviders(entry)
    }
  })
})

describe("Type sanity", () => {
  test("FallbackEntry.variant is optional", () => {
    const entry: FallbackEntry = { providers: ["quotio"], model: "claude-haiku-4-5" }
    expect(entry.variant).toBeUndefined()
  })

  test("ModelRequirement.variant is optional", () => {
    const req: ModelRequirement = { fallbackChain: [{ providers: ["quotio"], model: "claude-haiku-4-5" }] }
    expect(req.variant).toBeUndefined()
  })
})

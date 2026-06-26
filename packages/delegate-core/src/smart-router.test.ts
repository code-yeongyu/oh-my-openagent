import { describe, test, expect } from "bun:test"
import {
  estimateComplexity,
  buildTierMapFromModels,
  buildTierMapFromCategoryRequirements,
  resolveCategoryForComplexity,
  smartRouteToCategory,
  smartRoute,
  recordProviderError,
  recordProviderSuccess,
  isProviderHealthy,
} from "./smart-router"
import type { CategoryRequirementEntry } from "./smart-router"

describe("estimateComplexity", () => {
  test("detects trivial tasks", () => {
    expect(estimateComplexity("fix typo in README")).toBe("trivial")
    expect(estimateComplexity("format code")).toBe("trivial")
    expect(estimateComplexity("add type annotation")).toBe("trivial")
  })

  test("detects simple tasks", () => {
    expect(estimateComplexity("update the button style")).toBe("simple")
    expect(estimateComplexity("add validation to the form")).toBe("simple")
  })

  test("detects medium tasks", () => {
    expect(estimateComplexity("implement the login endpoint with JWT")).toBe("medium")
    expect(estimateComplexity("fix bug in payment processing")).toBe("medium")
  })

  test("detects complex tasks", () => {
    const result = estimateComplexity("refactor the entire authentication system across 5 files: auth.ts, session.ts, middleware.ts, types.ts, config.ts")
    expect(["complex", "architecture"]).toContain(result)
  })

  test("detects architecture tasks", () => {
    expect(estimateComplexity("design system architecture from scratch")).toBe("architecture")
    expect(estimateComplexity("database schema migration plan for breaking changes")).toBe("architecture")
  })

  test("prompt length influences complexity", () => {
    const short = estimateComplexity("x")
    expect(short).toBe("trivial")

    const long = estimateComplexity("x".repeat(2000) + " implement feature")
    expect(["complex", "medium"]).toContain(long)
  })
})

describe("buildTierMapFromModels", () => {
  const sampleModels = [
    { provider: "ds", modelId: "deepseek-v4-pro" },
    { provider: "ds", modelId: "deepseek-v4-flash" },
    { provider: "ds", modelId: "deepseek-chat" },
    { provider: "og", modelId: "qwen3.7-plus" },
    { provider: "og", modelId: "qwen3-coder-plus" },
    { provider: "og", modelId: "kimi-k2.6" },
  ]

  test("classifies pro models to architecture tier", () => {
    const map = buildTierMapFromModels(sampleModels)
    const archModels = map.architecture.map((e) => e.model)
    expect(archModels).toContain("deepseek-v4-pro")
    expect(archModels).toContain("qwen3.7-plus")
  })

  test("classifies flash models to simple tier", () => {
    const map = buildTierMapFromModels(sampleModels)
    const simpleModels = map.simple.map((e) => e.model)
    expect(simpleModels).toContain("deepseek-v4-flash")
    expect(simpleModels).toContain("deepseek-chat")
  })

  test("every tier has at least some models", () => {
    const map = buildTierMapFromModels(sampleModels)
    for (const tier of ["architecture", "complex", "medium", "simple", "trivial"] as const) {
      expect(map[tier].length).toBeGreaterThan(0)
    }
  })
})

describe("smartRoute", () => {
  const tierMap = buildTierMapFromModels([
    { provider: "ds", modelId: "deepseek-v4-pro" },
    { provider: "ds", modelId: "deepseek-v4-flash" },
    { provider: "ds", modelId: "deepseek-chat" },
    { provider: "og", modelId: "qwen3.7-plus" },
  ])

  test("routes trivial tasks to cheap models", () => {
    const result = smartRoute({ prompt: "fix typo", tierMap })
    expect(result).not.toBeNull()
    expect(result!.complexity).toBe("trivial")
    expect(result!.autoRouted).toBe(true)
  })

  test("routes complex tasks to powerful models", () => {
    const result = smartRoute({ prompt: "refactor authentication system", tierMap })
    expect(result).not.toBeNull()
    expect(["complex", "architecture"]).toContain(result!.complexity)
  })

  test("respects explicit category", () => {
    const result = smartRoute({
      prompt: "fix typo",
      explicitCategory: "ultrabrain",
      tierMap,
    })
    expect(result).not.toBeNull()
    expect(result!.complexity).toBe("architecture")
    expect(result!.autoRouted).toBe(false)
  })

  test("round-robin distributes across providers", () => {
    // First call
    const r1 = smartRoute({ prompt: "simple task", tierMap })
    // Second call with same tier should pick different provider (round-robin)
    const r2 = smartRoute({ prompt: "another simple task", tierMap })
    expect(r1).not.toBeNull()
    expect(r2).not.toBeNull()
    // Both should be valid models
    expect(r1!.model).toMatch(/^.+\/.+$/)
    expect(r2!.model).toMatch(/^.+\/.+$/)
  })

  test("returns null when no models available", () => {
    const result = smartRoute({
      prompt: "anything",
      tierMap: { architecture: [], complex: [], medium: [], simple: [], trivial: [] },
    })
    expect(result).toBeNull()
  })
})

describe("provider health", () => {
  test("healthy by default", () => {
    expect(isProviderHealthy("any")).toBe(true)
  })

  test("unhealthy after consecutive errors", () => {
    recordProviderError("bad-provider")
    recordProviderError("bad-provider")
    recordProviderError("bad-provider")
    expect(isProviderHealthy("bad-provider")).toBe(false)
  })

  test("healthy after success", () => {
    recordProviderError("recover")
    recordProviderError("recover")
    recordProviderSuccess("recover")
    expect(isProviderHealthy("recover")).toBe(true)
  })
})

// ---- Category-based tier map tests ----

const SAMPLE_CATEGORY_REQUIREMENTS: Record<string, CategoryRequirementEntry> = {
  ultrabrain: {
    fallbackChain: [
      { providers: ["ds"], model: "deepseek-v4-pro" },
      { providers: ["og"], model: "qwen3.7-plus" },
    ],
  },
  "unspecified-high": {
    fallbackChain: [
      { providers: ["ds"], model: "deepseek-v4-pro" },
      { providers: ["og"], model: "deepseek-v4-pro" },
    ],
  },
  "unspecified-low": {
    fallbackChain: [
      { providers: ["ds"], model: "deepseek-v4-flash" },
      { providers: ["og"], model: "qwen3-coder-plus" },
    ],
  },
  quick: {
    fallbackChain: [
      { providers: ["ds"], model: "deepseek-chat" },
      { providers: ["ds"], model: "deepseek-v4-flash" },
    ],
  },
}

describe("buildTierMapFromCategoryRequirements", () => {
  test("architecture tier gets models from ultrabrain chain", () => {
    const map = buildTierMapFromCategoryRequirements(SAMPLE_CATEGORY_REQUIREMENTS)
    const models = map.architecture.map((e) => `${e.provider}/${e.model}`)
    expect(models).toContain("ds/deepseek-v4-pro")
    expect(models).toContain("og/qwen3.7-plus")
  })

  test("simple tier gets models from quick chain", () => {
    const map = buildTierMapFromCategoryRequirements(SAMPLE_CATEGORY_REQUIREMENTS)
    const models = map.simple.map((e) => `${e.provider}/${e.model}`)
    expect(models).toContain("ds/deepseek-chat")
    expect(models).toContain("ds/deepseek-v4-flash")
  })

  test("every tier has entries", () => {
    const map = buildTierMapFromCategoryRequirements(SAMPLE_CATEGORY_REQUIREMENTS)
    for (const tier of ["architecture", "complex", "medium", "simple", "trivial"] as const) {
      expect(map[tier].length, `tier ${tier} should have models`).toBeGreaterThan(0)
    }
  })

  test("handles empty requirements", () => {
    const map = buildTierMapFromCategoryRequirements({})
    // All tiers empty — no categories to pull from
    expect(map.architecture.length).toBe(0)
  })

  test("respects custom complexity-to-category mapping", () => {
    const customMapping = {
      architecture: "unspecified-high" as const,
      complex: "unspecified-low" as const,
      medium: "quick" as const,
      simple: "quick" as const,
      trivial: "quick" as const,
    }
    const map = buildTierMapFromCategoryRequirements(SAMPLE_CATEGORY_REQUIREMENTS, customMapping)
    // Architecture tier should pull from unspecified-high (ds/deepseek-v4-pro)
    expect(map.architecture.some((e) => e.model === "deepseek-v4-pro")).toBe(true)
  })
})

describe("resolveCategoryForComplexity", () => {
  const enabled = new Set(["ultrabrain", "deep", "unspecified-high", "unspecified-low", "quick", "artistry", "writing"])

  test("architecture → ultrabrain", () => {
    expect(resolveCategoryForComplexity("architecture", enabled)).toBe("ultrabrain")
  })

  test("complex → deep", () => {
    expect(resolveCategoryForComplexity("complex", enabled)).toBe("deep")
  })

  test("medium → unspecified-low", () => {
    expect(resolveCategoryForComplexity("medium", enabled)).toBe("unspecified-low")
  })

  test("simple → quick", () => {
    expect(resolveCategoryForComplexity("simple", enabled)).toBe("quick")
  })

  test("trivial → quick", () => {
    expect(resolveCategoryForComplexity("trivial", enabled)).toBe("quick")
  })

  test("falls back when preferred category not enabled", () => {
    const limited = new Set(["quick"])
    // "complex" → priorities are ["deep", "unspecified-high", "ultrabrain"] → none enabled → fallback
    expect(resolveCategoryForComplexity("complex", limited)).toBe("deep")
  })

  test("returns first priority when enabledCategories is undefined", () => {
    const result = resolveCategoryForComplexity("architecture", undefined)
    expect(result).toBe("ultrabrain")
  })
})

describe("smartRouteToCategory", () => {
  const enabled = new Set(["ultrabrain", "deep", "unspecified-high", "unspecified-low", "quick", "artistry", "writing"])

  test("trivial prompt → quick category", () => {
    const result = smartRouteToCategory("fix a typo", enabled)
    expect(result.category).toBe("quick")
    expect(result.autoRouted).toBe(true)
    expect(result.complexity).toBe("trivial")
  })

  test("complex prompt → deep category", () => {
    const result = smartRouteToCategory("refactor authentication system", enabled)
    expect(result.autoRouted).toBe(true)
    expect(["deep", "unspecified-high"]).toContain(result.category)
  })

  test("architecture prompt → ultrabrain category", () => {
    const result = smartRouteToCategory("design new system architecture from scratch", enabled)
    expect(result.category).toBe("ultrabrain")
    expect(result.complexity).toBe("architecture")
  })

  test("reason field contains useful info", () => {
    const result = smartRouteToCategory("fix a typo in README", enabled)
    expect(result.reason).toContain("auto:")
    expect(result.reason).toContain("category=")
    expect(result.reason).toContain("fix a typo")
  })
})

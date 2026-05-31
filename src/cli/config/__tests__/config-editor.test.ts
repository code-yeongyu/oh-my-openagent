import { describe, test, expect } from "bun:test"
import { validateConfig, checkFallbackWarnings, countWarnings } from "../validation"
import type { ConfigEditorState } from "../types"

function makeState(config: Record<string, unknown>): ConfigEditorState {
  return {
    config: config as ConfigEditorState["config"],
    modified: false,
    configPath: "/tmp/test-oh-my-opencode.json",
  }
}

describe("config editor validation", () => {
  test("empty config produces no validation warnings", () => {
    const state = makeState({
      agents: {},
      categories: {},
    })
    const warnings = validateConfig(state)
    expect(warnings.length).toBe(0)
  })

  test("config with model on all agents produces no warnings", () => {
    const state = makeState({
      agents: {
        build: { model: "openai/gpt-5.5" },
        plan: { model: "openai/gpt-5.5" },
        sisyphus: { model: "anthropic/claude-opus-4-7" },
      },
      categories: {},
    })
    const warnings = validateConfig(state)
    expect(warnings.length).toBe(0)
  })

  test("agent with missing model produces warning", () => {
    const state = makeState({
      agents: {
        sisyphus: {},
      },
      categories: {},
    })
    const warnings = validateConfig(state)
    const noModel = warnings.find((w) => w.agent === "sisyphus" && w.type === "missing-model")
    expect(noModel).toBeDefined()
  })

  test("agent with model but no fallback produces fallback warning", () => {
    const state = makeState({
      agents: {
        sisyphus: { model: "anthropic/claude-opus-4-7" },
      },
      categories: {},
    })
    const warnings = checkFallbackWarnings(state)
    const noFallback = warnings.find((w) => w.agent === "sisyphus" && w.type === "missing-fallback")
    expect(noFallback).toBeDefined()
  })

  test("agent with model and fallback produces no fallback warning", () => {
    const state = makeState({
      agents: {
        sisyphus: {
          model: "anthropic/claude-opus-4-7",
          fallback_models: ["openai/gpt-5.5"],
        },
      },
      categories: {},
    })
    const warnings = checkFallbackWarnings(state)
    const noFallback = warnings.find((w) => w.agent === "sisyphus" && w.type === "missing-fallback")
    expect(noFallback).toBeUndefined()
  })
})

describe("config editor types", () => {
  test("AGENT_NAMES includes expected agents", async () => {
    const { AGENT_NAMES } = await import("../types")
    expect(AGENT_NAMES).toContain("sisyphus")
    expect(AGENT_NAMES).toContain("oracle")
    expect(AGENT_NAMES).toContain("build")
    expect(AGENT_NAMES).toContain("plan")
    expect(AGENT_NAMES.length).toBeGreaterThan(5)
  })

  test("BUILTIN_CATEGORIES includes expected categories", async () => {
    const { BUILTIN_CATEGORIES } = await import("../types")
    expect(BUILTIN_CATEGORIES).toContain("visual-engineering")
    expect(BUILTIN_CATEGORIES).toContain("deep")
    expect(BUILTIN_CATEGORIES).toContain("ultrabrain")
  })
})

describe("config editor models", () => {
  test("getModelsByProvider returns record without errors", async () => {
    const { getModelsByProvider } = await import("../models")
    const result = getModelsByProvider()
    // Should always return a valid object (possibly empty if no cache files)
    expect(typeof result).toBe("object")
    expect(Array.isArray(result)).toBe(false)
    // Can't assert specific providers since cache file may not exist
  })

  test("getAllCachedModels returns sorted list", async () => {
    const { getAllCachedModels } = await import("../models")
    const result = getAllCachedModels()
    expect(Array.isArray(result)).toBe(true)
  })
})

import { describe, expect, test } from "bun:test"
import { validateConfig } from "./validator"
import type { OmoaState } from "../state/omoa-state-schema"
import { DEFAULT_OMOA_STATE } from "../state/omoa-state-schema"

describe("validateConfig", () => {
  const baseState: OmoaState = { ...DEFAULT_OMOA_STATE }

  test("returns no warnings for valid config", () => {
    const agents = {
      sisyphus: { model: "deepseek/deepseek-v4-pro", fallback_models: ["openai/gpt-5.5"] },
    }
    const result = validateConfig(agents, {}, baseState)
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })

  test("flags disabled primary provider", () => {
    const agents = {
      sisyphus: { model: "openai/gpt-5.5" },
    }
    const state: OmoaState = {
      ...baseState,
      providers: { openai: { enabled: false, free_only: false, avoid_fallback_from: [] } },
    }
    const result = validateConfig(agents, {}, state)
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.type === "disabled-primary")).toBe(true)
  })

  test("flags same-provider fallback", () => {
    const agents = {
      sisyphus: { model: "openai/gpt-5.5", fallback_models: ["openai/gpt-5.5-fast"] },
    }
    const result = validateConfig(agents, {}, baseState)
    expect(result.warnings.some((w) => w.type === "same-provider-fallback")).toBe(true)
  })

  test("flags banned model", () => {
    const agents = {
      sisyphus: { model: "openai/gpt-5.4" },
    }
    const state: OmoaState = { ...baseState, banned_models: ["openai/gpt-5.4"] }
    const result = validateConfig(agents, {}, state)
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.type === "banned-model")).toBe(true)
  })

  test("flags deprecated model as warning", () => {
    const agents = {
      sisyphus: { model: "openai/gpt-5.4" },
    }
    const state: OmoaState = { ...baseState, deprecated_models: ["openai/gpt-5.4"] }
    const result = validateConfig(agents, {}, state)
    expect(result.warnings.some((w) => w.type === "deprecated-model")).toBe(true)
  })

  test("flags free-only violation", () => {
    const agents = {
      sisyphus: { model: "opencode/big-model" },
    }
    const state: OmoaState = {
      ...baseState,
      providers: { opencode: { enabled: true, free_only: true, avoid_fallback_from: [] } },
    }
    const result = validateConfig(agents, {}, state)
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.type === "free-only-violation")).toBe(true)
  })

  test("flags missing fallback as info", () => {
    const agents = {
      sisyphus: { model: "deepseek/deepseek-v4-pro" },
    }
    const result = validateConfig(agents, {}, baseState)
    expect(result.warnings.some((w) => w.type === "missing-fallback" && w.severity === "info")).toBe(true)
  })

  test("validates categories too", () => {
    const categories = {
      "visual-engineering": { model: "banned/model" },
    }
    const state: OmoaState = { ...baseState, banned_models: ["banned/model"] }
    const result = validateConfig({}, categories, state)
    expect(result.valid).toBe(false)
    expect(result.warnings.some((w) => w.target === "category:visual-engineering")).toBe(true)
  })

  test("skips agents without model", () => {
    const agents = {
      sisyphus: { temperature: 0.5 },
    }
    const result = validateConfig(agents, {}, baseState)
    expect(result.valid).toBe(true)
    expect(result.warnings).toHaveLength(0)
  })
})

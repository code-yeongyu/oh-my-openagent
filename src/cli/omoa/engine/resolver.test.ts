import { describe, expect, test } from "bun:test"
import { resolveBestModel, extractProvider } from "./resolver"
import type { OmoaState } from "../state/omoa-state-schema"
import type { ModelRankingEntry } from "../state/omoa-rankings-schema"
import { DEFAULT_OMOA_STATE } from "../state/omoa-state-schema"

describe("extractProvider", () => {
  test("extracts provider from provider/model format", () => {
    expect(extractProvider("openai/gpt-5.5")).toBe("openai")
  })

  test("returns full string if no slash", () => {
    expect(extractProvider("some-model")).toBe("some-model")
  })
})

describe("resolveBestModel", () => {
  const baseState: OmoaState = { ...DEFAULT_OMOA_STATE }

  test("returns undefined for empty rankings", () => {
    const result = resolveBestModel([], baseState)
    expect(result.primary).toBeUndefined()
    expect(result.fallback).toBeUndefined()
  })

  test("picks first available model as primary", () => {
    const rankings: ModelRankingEntry[] = [
      { model: "deepseek/deepseek-v4-pro" },
      { model: "openai/gpt-5.5" },
    ]
    const result = resolveBestModel(rankings, baseState)
    expect(result.primary).toBe("deepseek/deepseek-v4-pro")
  })

  test("skips disabled provider and picks next", () => {
    const rankings: ModelRankingEntry[] = [
      { model: "deepseek/deepseek-v4-pro" },
      { model: "openai/gpt-5.5" },
    ]
    const state: OmoaState = {
      ...baseState,
      providers: { deepseek: { enabled: false, free_only: false, avoid_fallback_from: [] } },
    }
    const result = resolveBestModel(rankings, state)
    expect(result.primary).toBe("openai/gpt-5.5")
  })

  test("skips banned models", () => {
    const rankings: ModelRankingEntry[] = [
      { model: "openai/gpt-5.4" },
      { model: "openai/gpt-5.5" },
    ]
    const state: OmoaState = { ...baseState, banned_models: ["openai/gpt-5.4"] }
    const result = resolveBestModel(rankings, state)
    expect(result.primary).toBe("openai/gpt-5.5")
  })

  test("picks cross-provider fallback", () => {
    const rankings: ModelRankingEntry[] = [
      { model: "openai/gpt-5.5" },
      { model: "openai/gpt-5.5-fast" },
      { model: "deepseek/deepseek-v4-pro" },
    ]
    const result = resolveBestModel(rankings, baseState)
    expect(result.primary).toBe("openai/gpt-5.5")
    expect(result.fallback).toBe("deepseek/deepseek-v4-pro")
  })

  test("no fallback if all same provider", () => {
    const rankings: ModelRankingEntry[] = [
      { model: "openai/gpt-5.5" },
      { model: "openai/gpt-5.5-fast" },
    ]
    const result = resolveBestModel(rankings, baseState)
    expect(result.primary).toBe("openai/gpt-5.5")
    expect(result.fallback).toBeUndefined()
  })

  test("respects avoid_fallback_from rules", () => {
    const rankings: ModelRankingEntry[] = [
      { model: "openai/gpt-5.5" },
      { model: "deepseek/deepseek-v4-pro" },
      { model: "kimi-for-coding/k2p6" },
    ]
    const state: OmoaState = {
      ...baseState,
      providers: { openai: { enabled: true, free_only: false, avoid_fallback_from: ["deepseek"] } },
    }
    const result = resolveBestModel(rankings, state)
    expect(result.primary).toBe("openai/gpt-5.5")
    expect(result.fallback).toBe("kimi-for-coding/k2p6")
  })

  test("enforces free_only on provider", () => {
    const rankings: ModelRankingEntry[] = [
      { model: "opencode/big-model" },
      { model: "opencode/nemotron-free" },
    ]
    const state: OmoaState = {
      ...baseState,
      providers: { opencode: { enabled: true, free_only: true, avoid_fallback_from: [] } },
    }
    const result = resolveBestModel(rankings, state)
    expect(result.primary).toBe("opencode/nemotron-free")
  })

  test("returns undefined when all models unavailable", () => {
    const rankings: ModelRankingEntry[] = [
      { model: "openai/gpt-5.5" },
    ]
    const state: OmoaState = {
      ...baseState,
      providers: { openai: { enabled: false, free_only: false, avoid_fallback_from: [] } },
    }
    const result = resolveBestModel(rankings, state)
    expect(result.primary).toBeUndefined()
  })
})

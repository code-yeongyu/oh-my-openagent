import { describe, expect, test } from "bun:test"
import {
  createFallbackState,
  extractProviderFromModel,
  isProviderInCooldown,
  markProviderFailed,
  findNextAvailableFallback,
  prepareFallback,
} from "./fallback-state"
import {
  snapshotFallbackState,
  restoreFallbackState,
} from "./fallback-state-snapshot"

describe("provider-level failure tracking", () => {
  describe("extractProviderFromModel", () => {
    test("extracts provider from model string", () => {
      expect(extractProviderFromModel("openai/gpt-4o")).toBe("openai")
      expect(extractProviderFromModel("anthropic/claude-3.5-sonnet")).toBe("anthropic")
      expect(extractProviderFromModel("google/gemini-pro")).toBe("google")
    })

    test("returns undefined for invalid model strings", () => {
      expect(extractProviderFromModel("gpt-4o")).toBeUndefined()
      expect(extractProviderFromModel("")).toBeUndefined()
    })
  })

  describe("createFallbackState with failedProviders", () => {
    test("initializes failedProviders map", () => {
      const state = createFallbackState("openai/gpt-4o")
      expect(state.failedProviders).toBeDefined()
      expect(state.failedProviders.size).toBe(0)
    })
  })

  describe("markProviderFailed", () => {
    test("marks provider as failed", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("openai/gpt-4o", state)
      expect(state.failedProviders.has("openai")).toBe(true)
      expect(state.failedProviders.get("openai")).toBeDefined()
    })

    test("does nothing for invalid model string", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("invalid-model", state)
      expect(state.failedProviders.size).toBe(0)
    })
  })

  describe("isProviderInCooldown", () => {
    test("returns false when provider not in cooldown", () => {
      const state = createFallbackState("openai/gpt-4o")
      expect(isProviderInCooldown("openai/gpt-4o", state, 60)).toBe(false)
    })

    test("returns true when provider in cooldown", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("openai/gpt-4o", state)
      expect(isProviderInCooldown("openai/gpt-4o-mini", state, 60)).toBe(true)
      expect(isProviderInCooldown("openai/gpt-4-turbo", state, 60)).toBe(true)
    })

    test("returns false for different provider", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("openai/gpt-4o", state)
      expect(isProviderInCooldown("anthropic/claude-3.5-sonnet", state, 60)).toBe(false)
    })
  })

  describe("findNextAvailableFallback with provider cooldown", () => {
    test("skips models from failed provider", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("openai/gpt-4o", state)
      
      const fallbackModels = [
        "openai/gpt-4o-mini",      // Same provider - should skip
        "openai/gpt-4-turbo",      // Same provider - should skip
        "anthropic/claude-3.5-sonnet", // Different provider - should select
      ]
      
      const next = findNextAvailableFallback(state, fallbackModels, 60)
      expect(next).toBe("anthropic/claude-3.5-sonnet")
    })

    test("returns undefined when all providers in cooldown", () => {
      const state = createFallbackState("openai/gpt-4o")
      markProviderFailed("openai/gpt-4o", state)
      markProviderFailed("anthropic/claude-3.5-sonnet", state)
      
      const fallbackModels = [
        "openai/gpt-4o-mini",
        "anthropic/claude-3.5-sonnet",
      ]
      
      const next = findNextAvailableFallback(state, fallbackModels, 60)
      expect(next).toBeUndefined()
    })
  })

  describe("prepareFallback with isProviderFailure", () => {
    test("marks provider failed when isProviderFailure is true", () => {
      const state = createFallbackState("openai/gpt-4o")
      const fallbackModels = ["anthropic/claude-3.5-sonnet"]
      const config = {
        enabled: true,
        max_fallback_attempts: 3,
        cooldown_seconds: 60,
        timeout_seconds: 30,
        retry_on_errors: [429, 500, 502, 503, 504],
      }
      
      const result = prepareFallback(
        "test-session",
        state,
        fallbackModels,
        config as any,
        { isProviderFailure: true }
      )
      
      expect(result.success).toBe(true)
      expect(state.failedProviders.has("openai")).toBe(true)
    })

    test("does not mark provider failed when isProviderFailure is false", () => {
      const state = createFallbackState("openai/gpt-4o")
      const fallbackModels = ["anthropic/claude-3.5-sonnet"]
      const config = {
        enabled: true,
        max_fallback_attempts: 3,
        cooldown_seconds: 60,
        timeout_seconds: 30,
        retry_on_errors: [429, 500, 502, 503, 504],
      }
      
      const result = prepareFallback(
        "test-session",
        state,
        fallbackModels,
        config as any,
        { isProviderFailure: false }
      )
      
      expect(result.success).toBe(true)
      expect(state.failedProviders.has("openai")).toBe(false)
    })
  })
})

describe("fallback-state-snapshot round-trip", () => {
  test("preserves failedProviders across snapshot/restore", () => {
    const state = createFallbackState("openai/gpt-4o")
    markProviderFailed("openai/gpt-4o", state)
    state.failedModels.set("openai/gpt-4o", Date.now())
    state.attemptCount = 2
    state.currentModel = "anthropic/claude-3.5-sonnet"
    state.fallbackIndex = 1

    const snapshot = snapshotFallbackState(state)
    
    // Mutate original state
    state.failedProviders.clear()
    state.failedModels.clear()
    state.attemptCount = 0

    // Restore from snapshot
    restoreFallbackState(state, snapshot)

    expect(state.failedProviders.has("openai")).toBe(true)
    expect(state.failedModels.has("openai/gpt-4o")).toBe(true)
    expect(state.attemptCount).toBe(2)
    expect(state.currentModel).toBe("anthropic/claude-3.5-sonnet")
    expect(state.fallbackIndex).toBe(1)
  })

  test("snapshot is independent copy (no shared references)", () => {
    const state = createFallbackState("openai/gpt-4o")
    markProviderFailed("openai/gpt-4o", state)
    
    const snapshot = snapshotFallbackState(state)
    
    // Mutating original should not affect snapshot
    state.failedProviders.set("anthropic", Date.now())
    
    expect(snapshot.failedProviders.has("anthropic")).toBe(false)
    expect(snapshot.failedProviders.size).toBe(1)
  })
})

/// <reference types="bun-types" />

import { describe, expect, test } from "bun:test"
import { createFallbackState, findNextAvailableFallback, prepareFallback, stringifyRuntimeModelWithVariant } from "./fallback-state"

describe("runtime-fallback fallback state", () => {
  test("#given object-shaped current model #when finding the next fallback #then equivalent models are skipped without crashing", () => {
    // given
    const state = createFallbackState({ providerID: "anthropic", modelID: "claude-sonnet-4-6" })
    const fallbackModels = ["github-copilot/claude-sonnet-4.6", "openai/gpt-5.4"]

    // when
    const nextModel = findNextAvailableFallback(state, fallbackModels, 60)

    // then
    expect(nextModel?.model).toBe("openai/gpt-5.4")
  })

  test("#given model object without variant and top-level variant #when stringifying runtime model #then top-level variant is preserved", () => {
    // given
    const model = { providerID: "github-copilot", modelID: "claude-haiku-4.5" }

    // when
    const runtimeModel = stringifyRuntimeModelWithVariant(model, "high")

    // then
    expect(runtimeModel).toBe("github-copilot/claude-haiku-4.5(high)")
  })

  test("#given model object with its own variant #when stringifying with a top-level variant #then model variant wins", () => {
    // given
    const model = { providerID: "github-copilot", modelID: "claude-haiku-4.5", variant: "low" }

    // when
    const runtimeModel = stringifyRuntimeModelWithVariant(model, "high")

    // then
    expect(runtimeModel).toBe("github-copilot/claude-haiku-4.5(low)")
  })

  test("#given duplicate models in fallback list #when preparing fallback #then fallbackIndex tracks actual position not indexOf", () => {
    // given
    const state = createFallbackState("openai/gpt-4o")
    const fallbackModels = [
      "anthropic/claude-3.5-sonnet",
      "openai/gpt-4o-mini",
      "anthropic/claude-3.5-sonnet", // duplicate at index 2
      "openai/gpt-4-turbo",
    ]
    const config = {
      enabled: true,
      max_fallback_attempts: 5,
      cooldown_seconds: 60,
      timeout_seconds: 30,
      retry_on_errors: [429, 500, 502, 503, 504],
      notify_on_fallback: true,
      restore_primary_after_cooldown: false,
    }

    // when - first fallback to index 0
    const result1 = prepareFallback("test-session", state, fallbackModels, config)

    // then - should use actual loop index (0), not indexOf
    expect(result1.success).toBe(true)
    if (result1.success) {
      expect(result1.newModel).toBe("anthropic/claude-3.5-sonnet")
    }
    expect(state.fallbackIndex).toBe(0)

    // when - simulate first model failing, set it in cooldown
    state.failedModels.set("anthropic/claude-3.5-sonnet", Date.now())

    // when - second fallback should start from index 1
    const result2 = prepareFallback("test-session", state, fallbackModels, config)

    // then - should skip to index 1 (openai/gpt-4o-mini), not re-check index 0
    expect(result2.success).toBe(true)
    if (result2.success) {
      expect(result2.newModel).toBe("openai/gpt-4o-mini")
    }
    // With the indexOf bug, this would be 0 (first occurrence of claude-3.5-sonnet)
    // With the fix, it should be 1 (actual loop position)
    expect(state.fallbackIndex).toBe(1)
  })

  test("#given findNextAvailableFallback #when called #then returns both model and index", () => {
    // given
    const state = createFallbackState("openai/gpt-4o")
    const fallbackModels = ["anthropic/claude-3.5-sonnet", "openai/gpt-4-turbo"]

    // when
    const result = findNextAvailableFallback(state, fallbackModels, 60)

    // then
    expect(result).toBeDefined()
    expect(result?.model).toBe("anthropic/claude-3.5-sonnet")
    expect(result?.index).toBe(0)
  })
})

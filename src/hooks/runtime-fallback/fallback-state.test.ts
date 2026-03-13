import { describe, expect, test, beforeEach } from "bun:test"
import { createFallbackState, findNextAvailableFallback, prepareFallback } from "./fallback-state"
import { blacklistProvider, clearBlacklist } from "../../shared/global-blacklist"

describe("fallback-state", () => {
  beforeEach(async () => {
    await clearBlacklist()
  })

  describe("findNextAvailableFallback", () => {
    test("returns first non-blacklisted model", async () => {
      const state = createFallbackState("anthropic/claude-opus-4-6")
      const fallbackModels = [
        "anthropic/claude-sonnet-4-6",
        "alibaba-coding-plan/kimi-k2.5",
        "openai/gpt-5.3-codex"
      ]

      // Blacklist anthropic
      await blacklistProvider("anthropic", 3600)

      const result = await findNextAvailableFallback(state, fallbackModels, 3600)
      expect(result).toBe("alibaba-coding-plan/kimi-k2.5")
    })

    test("skips all blacklisted providers", async () => {
      const state = createFallbackState("anthropic/claude-opus-4-6")
      const fallbackModels = [
        "anthropic/claude-sonnet-4-6",
        "zai-coding-plan/glm-5",
        "openai/gpt-5.3-codex"
      ]

      // Blacklist anthropic and zai
      await blacklistProvider("anthropic", 3600)
      await blacklistProvider("zai-coding-plan", 3600)

      const result = await findNextAvailableFallback(state, fallbackModels, 3600)
      expect(result).toBe("openai/gpt-5.3-codex")
    })

    test("returns undefined when all models are blacklisted", async () => {
      const state = createFallbackState("anthropic/claude-opus-4-6")
      const fallbackModels = [
        "anthropic/claude-sonnet-4-6",
        "zai-coding-plan/glm-5"
      ]

      // Blacklist all providers
      await blacklistProvider("anthropic", 3600)
      await blacklistProvider("zai-coding-plan", 3600)

      const result = await findNextAvailableFallback(state, fallbackModels, 3600)
      expect(result).toBeUndefined()
    })

    test("respects session-level cooldown", async () => {
      const state = createFallbackState("anthropic/claude-opus-4-6")
      const fallbackModels = [
        "anthropic/claude-sonnet-4-6",
        "openai/gpt-5.3-codex"
      ]

      // Add first model to failedModels (session cooldown)
      state.failedModels.set("anthropic/claude-sonnet-4-6", Date.now())

      const result = await findNextAvailableFallback(state, fallbackModels, 3600)
      expect(result).toBe("openai/gpt-5.3-codex")
    })
  })

  describe("prepareFallback", () => {
    test("updates state with next available model", async () => {
      const state = createFallbackState("anthropic/claude-opus-4-6")
      const fallbackModels = ["openai/gpt-5.3-codex", "zai-coding-plan/glm-5"]
      const config = {
        max_fallback_attempts: 5,
        cooldown_seconds: 3600,
      } as any

      const result = await prepareFallback("test-session", state, fallbackModels, config)

      expect(result.success).toBe(true)
      expect(result.newModel).toBe("openai/gpt-5.3-codex")
      expect(state.currentModel).toBe("openai/gpt-5.3-codex")
      expect(state.attemptCount).toBe(1)
      expect(state.fallbackIndex).toBe(0)
    })

    test("skips blacklisted models", async () => {
      const state = createFallbackState("anthropic/claude-opus-4-6")
      const fallbackModels = [
        "anthropic/claude-sonnet-4-6",
        "openai/gpt-5.3-codex"
      ]
      const config = {
        max_fallback_attempts: 5,
        cooldown_seconds: 3600,
      } as any

      // Blacklist anthropic
      await blacklistProvider("anthropic", 3600)

      const result = await prepareFallback("test-session", state, fallbackModels, config)

      expect(result.success).toBe(true)
      expect(result.newModel).toBe("openai/gpt-5.3-codex")
    })

    test("returns error when max attempts reached", async () => {
      const state = createFallbackState("anthropic/claude-opus-4-6")
      state.attemptCount = 5
      const fallbackModels = ["openai/gpt-5.3-codex"]
      const config = {
        max_fallback_attempts: 5,
        cooldown_seconds: 3600,
      } as any

      const result = await prepareFallback("test-session", state, fallbackModels, config)

      expect(result.success).toBe(false)
      expect(result.error).toBe("Max fallback attempts reached")
      expect(result.maxAttemptsReached).toBe(true)
    })

    test("returns error when no fallback models available", async () => {
      const state = createFallbackState("anthropic/claude-opus-4-6")
      const fallbackModels: string[] = []
      const config = {
        max_fallback_attempts: 5,
        cooldown_seconds: 3600,
      } as any

      const result = await prepareFallback("test-session", state, fallbackModels, config)

      expect(result.success).toBe(false)
      expect(result.error).toBe("No available fallback models (all in cooldown or exhausted)")
    })
  })
})

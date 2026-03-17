import { describe, expect, test, beforeEach, afterEach, mock, spyOn } from "bun:test"
import { resolveModelForDelegateTask } from "./model-selection"
import { blacklistProvider, clearBlacklist } from "../../shared/global-blacklist"
import * as connectedProvidersCache from "../../shared/connected-providers-cache"

describe("model-selection", () => {
  let hasConnectedProvidersSpy: ReturnType<typeof spyOn>
  let hasProviderModelsSpy: ReturnType<typeof spyOn>

  beforeEach(async () => {
    await clearBlacklist()
  })

  afterEach(() => {
    if (hasConnectedProvidersSpy) hasConnectedProvidersSpy.mockRestore()
    if (hasProviderModelsSpy) hasProviderModelsSpy.mockRestore()
  })

  describe("resolveModelForDelegateTask", () => {
    describe("blacklist filtering", () => {
      test("filters blacklisted providers from userFallbackModels", async () => {
        const input = {
          userFallbackModels: [
            "anthropic/claude-sonnet-4-6",
            "alibaba-coding-plan/kimi-k2.5",
            "openai/gpt-5.3-codex"
          ],
          availableModels: new Set([
            "anthropic/claude-sonnet-4-6",
            "alibaba-coding-plan/kimi-k2.5",
            "openai/gpt-5.3-codex"
          ])
        }

        // Blacklist anthropic
        await blacklistProvider("anthropic", 3600)

        const result = await resolveModelForDelegateTask(input as any)
        expect(result?.model).toBe("alibaba-coding-plan/kimi-k2.5")
      })

      test("filters blacklisted providers from fallbackChain", async () => {
        const input = {
          fallbackChain: [
            { providers: ["anthropic", "github-copilot"], model: "claude-sonnet-4-6" },
            { providers: ["zai-coding-plan"], model: "glm-5" },
            { providers: ["openai"], model: "gpt-5.3-codex" }
          ],
          availableModels: new Set([
            "anthropic/claude-sonnet-4-6",
            "zai-coding-plan/glm-5",
            "openai/gpt-5.3-codex"
          ])
        }

        // Blacklist anthropic and zai
        await blacklistProvider("anthropic", 3600)
        await blacklistProvider("zai-coding-plan", 3600)

        const result = await resolveModelForDelegateTask(input as any)
        expect(result?.model).toBe("openai/gpt-5.3-codex")
      })

      test("returns undefined when all providers are blacklisted", async () => {
        const input = {
          userFallbackModels: [
            "anthropic/claude-sonnet-4-6",
            "zai-coding-plan/glm-5"
          ],
          availableModels: new Set([
            "anthropic/claude-sonnet-4-6",
            "zai-coding-plan/glm-5"
          ])
        }

        // Blacklist all providers
        await blacklistProvider("anthropic", 3600)
        await blacklistProvider("zai-coding-plan", 3600)

        const result = await resolveModelForDelegateTask(input as any)
        expect(result).toBeUndefined()
      })

      test("prioritizes userFallbackModels over fallbackChain", async () => {
        const input = {
          userFallbackModels: ["openai/gpt-5.3-codex"],
          fallbackChain: [
            { providers: ["anthropic"], model: "claude-sonnet-4-6" }
          ],
          availableModels: new Set([
            "openai/gpt-5.3-codex",
            "anthropic/claude-sonnet-4-6"
          ])
        }

        const result = await resolveModelForDelegateTask(input as any)
        expect(result?.model).toBe("openai/gpt-5.3-codex")
      })
    })

    describe("#when availableModels is empty and no user model override", () => {
      test("#then returns skipped sentinel to leave model unpinned", () => {
        const result = resolveModelForDelegateTask({
          categoryDefaultModel: "anthropic/claude-sonnet-4-6",
          fallbackChain: [
            { providers: ["anthropic"], model: "claude-sonnet-4-6" },
          ],
          availableModels: new Set(),
          systemDefaultModel: "anthropic/claude-sonnet-4-6",
        })

        expect(result).toEqual({ skipped: true })
      })
    })

    describe("#when user set fallback_models but no cache exists", () => {
      test("#then returns skipped sentinel (skip fallback resolution without cache)", () => {
        const result = resolveModelForDelegateTask({
          userFallbackModels: ["openai/gpt-5.4", "google/gemini-3.1-pro"],
          categoryDefaultModel: "anthropic/claude-sonnet-4-6",
          fallbackChain: [
            { providers: ["anthropic"], model: "claude-sonnet-4-6" },
          ],
          availableModels: new Set(),
        })

        expect(result).toEqual({ skipped: true })
      })
    })

    describe("#when availableModels is empty (cache exists but empty)", () => {
      test("#then falls through to category default model (existing behavior)", () => {
        const result = resolveModelForDelegateTask({
          categoryDefaultModel: "anthropic/claude-sonnet-4-6",
          fallbackChain: [
            { providers: ["anthropic"], model: "claude-sonnet-4-6" },
          ],
          availableModels: new Set(),
          systemDefaultModel: "anthropic/claude-sonnet-4-6",
        })

        expect(result).toEqual({ model: "anthropic/claude-sonnet-4-6" })
      })
    })

    describe("#when availableModels has entries and category default matches", () => {
      test("#then resolves via fuzzy match (existing behavior)", () => {
        const result = resolveModelForDelegateTask({
          categoryDefaultModel: "anthropic/claude-sonnet-4-6",
          fallbackChain: [
            { providers: ["anthropic"], model: "claude-sonnet-4-6" },
          ],
          availableModels: new Set(["anthropic/claude-sonnet-4-6"]),
        })

        expect(result).toEqual({ model: "anthropic/claude-sonnet-4-6" })
      })
    })

    describe("#when user fallback models include variant syntax", () => {
      test("#then resolves a parenthesized variant against the base available model", () => {
        const result = resolveModelForDelegateTask({
          userFallbackModels: ["openai/gpt-5.2(high)"],
          availableModels: new Set(["openai/gpt-5.2"]),
        })

        expect(result).toEqual({ model: "openai/gpt-5.2", variant: "high" })
      })

      test("#then resolves a space-separated variant against the base available model", () => {
        const result = resolveModelForDelegateTask({
          userFallbackModels: ["gpt-5.2 medium"],
          availableModels: new Set(["openai/gpt-5.2"]),
        })

        expect(result).toEqual({ model: "openai/gpt-5.2", variant: "medium" })
      })
    })
  })

  describe("#given only connected providers cache exists (no provider-models cache)", () => {
    beforeEach(() => {
      hasConnectedProvidersSpy = spyOn(connectedProvidersCache, "hasConnectedProvidersCache").mockReturnValue(true)
      hasProviderModelsSpy = spyOn(connectedProvidersCache, "hasProviderModelsCache").mockReturnValue(false)
    })

    describe("#when availableModels is empty", () => {
      test("#then falls through to existing resolution (cache partially ready)", () => {
        const result = resolveModelForDelegateTask({
          categoryDefaultModel: "anthropic/claude-sonnet-4-6",
          fallbackChain: [
            { providers: ["anthropic"], model: "claude-sonnet-4-6" },
          ],
          availableModels: new Set(),
        })

        expect(result).toBeDefined()
      })
    })
  })
})

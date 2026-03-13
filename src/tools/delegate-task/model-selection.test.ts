import { describe, expect, test, beforeEach } from "bun:test"
import { resolveModelForDelegateTask } from "./model-selection"
import { blacklistProvider, clearBlacklist } from "../../shared/global-blacklist"

describe("model-selection", () => {
  beforeEach(async () => {
    await clearBlacklist()
  })

  describe("resolveModelForDelegateTask", () => {
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
})

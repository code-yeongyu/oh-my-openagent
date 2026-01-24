import { describe, expect, test, spyOn, beforeEach, afterEach } from "bun:test"
import { resolveModel, resolveModelWithFallback, type ModelResolutionInput, type ExtendedModelResolutionInput, type ModelResolutionResult, type ModelSource } from "./model-resolver"
import * as logger from "./logger"

describe("resolveModel", () => {
  describe("priority chain", () => {
    test("returns userModel when all three are set", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-5",
        inheritedModel: "openai/gpt-5.2",
        systemDefault: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModel(input)

      // #then
      expect(result).toBe("anthropic/claude-opus-4-5")
    })

    test("returns inheritedModel when userModel is undefined", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: undefined,
        inheritedModel: "openai/gpt-5.2",
        systemDefault: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModel(input)

      // #then
      expect(result).toBe("openai/gpt-5.2")
    })

    test("returns systemDefault when both userModel and inheritedModel are undefined", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: undefined,
        inheritedModel: undefined,
        systemDefault: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModel(input)

      // #then
      expect(result).toBe("google/gemini-3-pro")
    })
  })

  describe("empty string handling", () => {
    test("treats empty string as unset, uses fallback", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: "",
        inheritedModel: "openai/gpt-5.2",
        systemDefault: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModel(input)

      // #then
      expect(result).toBe("openai/gpt-5.2")
    })

    test("treats whitespace-only string as unset, uses fallback", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: "   ",
        inheritedModel: "",
        systemDefault: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModel(input)

      // #then
      expect(result).toBe("google/gemini-3-pro")
    })
  })

  describe("purity", () => {
    test("same input returns same output (referential transparency)", () => {
      // #given
      const input: ModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-5",
        inheritedModel: "openai/gpt-5.2",
        systemDefault: "google/gemini-3-pro",
      }

      // #when
      const result1 = resolveModel(input)
      const result2 = resolveModel(input)

      // #then
      expect(result1).toBe(result2)
    })
  })
})

describe("resolveModelWithFallback", () => {
  let logSpy: ReturnType<typeof spyOn>

  beforeEach(() => {
    logSpy = spyOn(logger, "log")
  })

  afterEach(() => {
    logSpy.mockRestore()
  })

  describe("Step 1: Override", () => {
    test("returns userModel with override source when userModel is provided", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-5",
        fallbackChain: [
          { providers: ["anthropic", "github-copilot"], model: "claude-opus-4-5" },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-5", "github-copilot/claude-opus-4-5-preview"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.model).toBe("anthropic/claude-opus-4-5")
      expect(result.source).toBe("override")
      expect(logSpy).toHaveBeenCalledWith("Model resolved via override", { model: "anthropic/claude-opus-4-5" })
    })

    test("override takes priority even if model not in availableModels", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        userModel: "custom/my-model",
        fallbackChain: [
          { providers: ["anthropic"], model: "claude-opus-4-5" },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.model).toBe("custom/my-model")
      expect(result.source).toBe("override")
    })

    test("whitespace-only userModel is treated as not provided", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        userModel: "   ",
        fallbackChain: [
          { providers: ["anthropic"], model: "claude-opus-4-5" },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.source).not.toBe("override")
    })

    test("empty string userModel is treated as not provided", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        userModel: "",
        fallbackChain: [
          { providers: ["anthropic"], model: "claude-opus-4-5" },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.source).not.toBe("override")
    })
  })

  describe("Step 2: Provider fallback chain", () => {
    test("tries providers in order within entry and returns first match", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-5" },
        ],
        availableModels: new Set(["github-copilot/claude-opus-4-5-preview", "opencode/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.model).toBe("github-copilot/claude-opus-4-5-preview")
      expect(result.source).toBe("provider-fallback")
      expect(logSpy).toHaveBeenCalledWith("Model resolved via fallback chain (availability confirmed)", {
        provider: "github-copilot",
        model: "claude-opus-4-5",
        match: "github-copilot/claude-opus-4-5-preview",
        variant: undefined,
      })
    })

    test("respects provider priority order within entry", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["openai", "anthropic", "google"], model: "gpt-5.2" },
        ],
        availableModels: new Set(["openai/gpt-5.2", "anthropic/claude-opus-4-5", "google/gemini-3-pro"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.model).toBe("openai/gpt-5.2")
      expect(result.source).toBe("provider-fallback")
    })

    test("tries next provider when first provider has no match", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic", "opencode", "github-copilot"], model: "gpt-5-nano" },
        ],
        availableModels: new Set(["opencode/gpt-5-nano", "github-copilot/gpt-5-nano-preview"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.model).toBe("opencode/gpt-5-nano")
      expect(result.source).toBe("provider-fallback")
    })

    test("uses fuzzy matching within provider", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic", "github-copilot"], model: "claude-opus" },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-5", "github-copilot/claude-opus-4-5-preview"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.model).toBe("anthropic/claude-opus-4-5")
      expect(result.source).toBe("provider-fallback")
    })

    test("skips fallback chain when not provided", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        availableModels: new Set(["anthropic/claude-opus-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.source).toBe("system-default")
    })

    test("skips fallback chain when empty", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [],
        availableModels: new Set(["anthropic/claude-opus-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.source).toBe("system-default")
    })

    test("case-insensitive fuzzy matching", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic"], model: "CLAUDE-OPUS" },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.model).toBe("anthropic/claude-opus-4-5")
      expect(result.source).toBe("provider-fallback")
    })
  })

  describe("Step 3: System default fallback (no availability match)", () => {
    test("returns system default when no availability match found in fallback chain", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic"], model: "nonexistent-model" },
        ],
        availableModels: new Set(["openai/gpt-5.2", "anthropic/claude-opus-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.model).toBe("google/gemini-3-pro")
      expect(result.source).toBe("system-default")
      expect(logSpy).toHaveBeenCalledWith("No available model found in fallback chain, falling through to system default")
    })

    test("uses first fallback entry when availableModels is empty (no cache scenario)", () => {
      // #given - empty availableModels simulates CI environment without model cache
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic"], model: "claude-opus-4-5" },
        ],
        availableModels: new Set(),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should use first fallback entry, not system default
      expect(result.model).toBe("anthropic/claude-opus-4-5")
      expect(result.source).toBe("provider-fallback")
    })

    test("returns system default when fallbackChain is not provided", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        availableModels: new Set(["openai/gpt-5.2"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result.model).toBe("google/gemini-3-pro")
      expect(result.source).toBe("system-default")
    })
  })

  describe("Multi-entry fallbackChain", () => {
    test("resolves to claude-opus when OpenAI unavailable but Anthropic available (oracle scenario)", () => {
      // #given
      const availableModels = new Set(["anthropic/claude-opus-4-5"])

      // #when
      const result = resolveModelWithFallback({
        fallbackChain: [
          { providers: ["openai", "github-copilot", "opencode"], model: "gpt-5.2", variant: "high" },
          { providers: ["anthropic", "github-copilot", "opencode"], model: "claude-opus-4-5", variant: "max" },
        ],
        availableModels,
        systemDefaultModel: "system/default",
      })

      // #then
      expect(result.model).toBe("anthropic/claude-opus-4-5")
      expect(result.source).toBe("provider-fallback")
    })

    test("tries all providers in first entry before moving to second entry", () => {
      // #given
      const availableModels = new Set(["google/gemini-3-pro"])

      // #when
      const result = resolveModelWithFallback({
        fallbackChain: [
          { providers: ["openai", "anthropic"], model: "gpt-5.2" },
          { providers: ["google"], model: "gemini-3-pro" },
        ],
        availableModels,
        systemDefaultModel: "system/default",
      })

      // #then
      expect(result.model).toBe("google/gemini-3-pro")
      expect(result.source).toBe("provider-fallback")
    })

    test("returns first matching entry even if later entries have better matches", () => {
      // #given
      const availableModels = new Set([
        "openai/gpt-5.2",
        "anthropic/claude-opus-4-5",
      ])

      // #when
      const result = resolveModelWithFallback({
        fallbackChain: [
          { providers: ["openai"], model: "gpt-5.2" },
          { providers: ["anthropic"], model: "claude-opus-4-5" },
        ],
        availableModels,
        systemDefaultModel: "system/default",
      })

      // #then
      expect(result.model).toBe("openai/gpt-5.2")
      expect(result.source).toBe("provider-fallback")
    })

    test("falls through to system default when none match availability", () => {
      // #given
      const availableModels = new Set(["other/model"])

      // #when
      const result = resolveModelWithFallback({
        fallbackChain: [
          { providers: ["openai"], model: "gpt-5.2" },
          { providers: ["anthropic"], model: "claude-opus-4-5" },
          { providers: ["google"], model: "gemini-3-pro" },
        ],
        availableModels,
        systemDefaultModel: "system/default",
      })

      // #then
      expect(result.model).toBe("system/default")
      expect(result.source).toBe("system-default")
    })
  })

  describe("Type safety", () => {
    test("result has correct ModelResolutionResult shape", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-5",
        availableModels: new Set(),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result: ModelResolutionResult = resolveModelWithFallback(input)

      // #then
      expect(typeof result.model).toBe("string")
      expect(["override", "provider-fallback", "system-default"]).toContain(result.source)
    })
  })
})

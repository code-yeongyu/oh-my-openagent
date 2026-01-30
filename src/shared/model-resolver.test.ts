import { describe, expect, test, spyOn, beforeEach, afterEach, mock } from "bun:test"
import { resolveModel, resolveModelWithFallback, type ModelResolutionInput, type ExtendedModelResolutionInput, type ModelResolutionResult, type ModelSource } from "./model-resolver"
import * as logger from "./logger"
import * as connectedProvidersCache from "./connected-providers-cache"

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

  describe("Step 1: UI Selection (highest priority)", () => {
    test("returns uiSelectedModel with override source when provided", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        uiSelectedModel: "opencode/glm-4.7-free",
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
      expect(result!.model).toBe("opencode/glm-4.7-free")
      expect(result!.source).toBe("override")
      expect(logSpy).toHaveBeenCalledWith("Model resolved via UI selection", { model: "opencode/glm-4.7-free" })
    })

    test("UI selection takes priority over config override", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        uiSelectedModel: "opencode/glm-4.7-free",
        userModel: "anthropic/claude-opus-4-5",
        availableModels: new Set(["anthropic/claude-opus-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result!.model).toBe("opencode/glm-4.7-free")
      expect(result!.source).toBe("override")
    })

    test("whitespace-only uiSelectedModel is treated as not provided", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        uiSelectedModel: "   ",
        userModel: "anthropic/claude-opus-4-5",
        availableModels: new Set(["anthropic/claude-opus-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result!.model).toBe("anthropic/claude-opus-4-5")
      expect(logSpy).toHaveBeenCalledWith("Model resolved via config override", { model: "anthropic/claude-opus-4-5" })
    })

    test("empty string uiSelectedModel falls through to config override", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        uiSelectedModel: "",
        userModel: "anthropic/claude-opus-4-5",
        availableModels: new Set(["anthropic/claude-opus-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result!.model).toBe("anthropic/claude-opus-4-5")
    })
  })

  describe("Step 2: Config Override", () => {
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
      expect(result!.model).toBe("anthropic/claude-opus-4-5")
      expect(result!.source).toBe("override")
      expect(logSpy).toHaveBeenCalledWith("Model resolved via config override", { model: "anthropic/claude-opus-4-5" })
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
      expect(result!.model).toBe("custom/my-model")
      expect(result!.source).toBe("override")
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
      expect(result!.source).not.toBe("override")
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
      expect(result!.source).not.toBe("override")
    })
  })

  describe("Step 3: Provider fallback chain", () => {
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
      expect(result!.model).toBe("github-copilot/claude-opus-4-5-preview")
      expect(result!.source).toBe("provider-fallback")
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
      expect(result!.model).toBe("openai/gpt-5.2")
      expect(result!.source).toBe("provider-fallback")
    })

    test("tries next provider when first provider has no match", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic", "opencode"], model: "gpt-5-nano" },
        ],
        availableModels: new Set(["opencode/gpt-5-nano"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result!.model).toBe("opencode/gpt-5-nano")
      expect(result!.source).toBe("provider-fallback")
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
      expect(result!.model).toBe("anthropic/claude-opus-4-5")
      expect(result!.source).toBe("provider-fallback")
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
      expect(result!.source).toBe("system-default")
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
      expect(result!.source).toBe("system-default")
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
      expect(result!.model).toBe("anthropic/claude-opus-4-5")
      expect(result!.source).toBe("provider-fallback")
    })

    test("cross-provider fuzzy match when preferred provider unavailable (librarian scenario)", () => {
      // #given - glm-4.7 is defined for zai-coding-plan, but only opencode has it
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["zai-coding-plan"], model: "glm-4.7" },
          { providers: ["anthropic"], model: "claude-sonnet-4-5" },
        ],
        availableModels: new Set(["opencode/glm-4.7", "anthropic/claude-sonnet-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should find glm-4.7 from opencode via cross-provider fuzzy match
      expect(result!.model).toBe("opencode/glm-4.7")
      expect(result!.source).toBe("provider-fallback")
      expect(logSpy).toHaveBeenCalledWith("Model resolved via fallback chain (cross-provider fuzzy match)", {
        model: "glm-4.7",
        match: "opencode/glm-4.7",
        variant: undefined,
      })
    })

    test("prefers specified provider over cross-provider match", () => {
      // #given - both zai-coding-plan and opencode have glm-4.7
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["zai-coding-plan"], model: "glm-4.7" },
        ],
        availableModels: new Set(["zai-coding-plan/glm-4.7", "opencode/glm-4.7"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should prefer zai-coding-plan (specified provider) over opencode
      expect(result!.model).toBe("zai-coding-plan/glm-4.7")
      expect(result!.source).toBe("provider-fallback")
    })

    test("cross-provider match preserves variant from entry", () => {
      // #given - entry has variant, model found via cross-provider
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["zai-coding-plan"], model: "glm-4.7", variant: "high" },
        ],
        availableModels: new Set(["opencode/glm-4.7"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - variant should be preserved
      expect(result!.model).toBe("opencode/glm-4.7")
      expect(result!.variant).toBe("high")
    })

    test("cross-provider match tries next entry if no match found anywhere", () => {
      // #given - first entry model not available anywhere, second entry available
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["zai-coding-plan"], model: "nonexistent-model" },
          { providers: ["anthropic"], model: "claude-sonnet-4-5" },
        ],
        availableModels: new Set(["anthropic/claude-sonnet-4-5"]),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should fall through to second entry
      expect(result!.model).toBe("anthropic/claude-sonnet-4-5")
      expect(result!.source).toBe("provider-fallback")
    })
  })

  describe("Step 4: System default fallback (no availability match)", () => {
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
      expect(result!.model).toBe("google/gemini-3-pro")
      expect(result!.source).toBe("system-default")
      expect(logSpy).toHaveBeenCalledWith("No available model found in fallback chain, falling through to system default")
    })

    test("returns undefined when availableModels empty and no connected providers cache exists", () => {
      // #given - both model cache and connected-providers cache are missing (first run)
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic"], model: "claude-opus-4-5" },
        ],
        availableModels: new Set(),
        systemDefaultModel: undefined, // no system default configured
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should return undefined to let OpenCode use Provider.defaultModel()
      expect(result).toBeUndefined()
      cacheSpy.mockRestore()
    })

    test("uses connected provider from fallback when availableModels empty but cache exists", () => {
      // #given - model cache missing but connected-providers cache exists
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["openai", "google"])
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic", "openai"], model: "claude-opus-4-5" },
        ],
        availableModels: new Set(),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should use connected provider (openai) from fallback chain
      expect(result!.model).toBe("openai/claude-opus-4-5")
      expect(result!.source).toBe("provider-fallback")
      cacheSpy.mockRestore()
    })

    test("uses github-copilot when google not connected (visual-engineering scenario)", () => {
      // #given - user has github-copilot but not google connected
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["github-copilot"])
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
        ],
        availableModels: new Set(),
        systemDefaultModel: "anthropic/claude-sonnet-4-5",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should use github-copilot (second provider) since google not connected
      expect(result!.model).toBe("github-copilot/gemini-3-pro")
      expect(result!.source).toBe("provider-fallback")
      cacheSpy.mockRestore()
    })

    test("falls through to system default when no provider in fallback is connected", () => {
      // #given - user only has quotio connected, but fallback chain has anthropic/opencode
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["quotio"])
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic", "opencode"], model: "claude-haiku-4-5" },
        ],
        availableModels: new Set(),
        systemDefaultModel: "quotio/claude-opus-4-5-20251101",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - no provider in fallback is connected, fall through to system default
      expect(result!.model).toBe("quotio/claude-opus-4-5-20251101")
      expect(result!.source).toBe("system-default")
      cacheSpy.mockRestore()
    })

    test("falls through to system default when no cache and systemDefaultModel is provided", () => {
      // #given - no cache but system default is configured
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic"], model: "claude-opus-4-5" },
        ],
        availableModels: new Set(),
        systemDefaultModel: "google/gemini-3-pro",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should fall through to system default
      expect(result!.model).toBe("google/gemini-3-pro")
      expect(result!.source).toBe("system-default")
      cacheSpy.mockRestore()
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
      expect(result!.model).toBe("google/gemini-3-pro")
      expect(result!.source).toBe("system-default")
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
      expect(result!.model).toBe("anthropic/claude-opus-4-5")
      expect(result!.source).toBe("provider-fallback")
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
      expect(result!.model).toBe("google/gemini-3-pro")
      expect(result!.source).toBe("provider-fallback")
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
      expect(result!.model).toBe("openai/gpt-5.2")
      expect(result!.source).toBe("provider-fallback")
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
      expect(result!.model).toBe("system/default")
      expect(result!.source).toBe("system-default")
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
      const result = resolveModelWithFallback(input)

      // #then
      expect(result).toBeDefined()
      expect(typeof result!.model).toBe("string")
      expect(["override", "provider-fallback", "system-default"]).toContain(result!.source)
    })
  })

  describe("categoryDefaultModel (fuzzy matching for category defaults)", () => {
    test("applies fuzzy matching to categoryDefaultModel when userModel not provided", () => {
      // #given - gemini-3-pro is the category default, but only gemini-3-pro-preview is available
      const input: ExtendedModelResolutionInput = {
        categoryDefaultModel: "google/gemini-3-pro",
        fallbackChain: [
          { providers: ["google", "github-copilot", "opencode"], model: "gemini-3-pro" },
        ],
        availableModels: new Set(["google/gemini-3-pro-preview", "anthropic/claude-opus-4-5"]),
        systemDefaultModel: "anthropic/claude-sonnet-4-5",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should fuzzy match gemini-3-pro → gemini-3-pro-preview
      expect(result!.model).toBe("google/gemini-3-pro-preview")
      expect(result!.source).toBe("category-default")
    })

    test("categoryDefaultModel uses exact match when available", () => {
      // #given - exact match exists
      const input: ExtendedModelResolutionInput = {
        categoryDefaultModel: "google/gemini-3-pro",
        fallbackChain: [
          { providers: ["google"], model: "gemini-3-pro" },
        ],
        availableModels: new Set(["google/gemini-3-pro", "google/gemini-3-pro-preview"]),
        systemDefaultModel: "anthropic/claude-sonnet-4-5",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should use exact match
      expect(result!.model).toBe("google/gemini-3-pro")
      expect(result!.source).toBe("category-default")
    })

    test("categoryDefaultModel falls through to fallbackChain when no match in availableModels", () => {
      // #given - categoryDefaultModel has no match, but fallbackChain does
      const input: ExtendedModelResolutionInput = {
        categoryDefaultModel: "google/gemini-3-pro",
        fallbackChain: [
          { providers: ["anthropic"], model: "claude-opus-4-5" },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-5"]),
        systemDefaultModel: "system/default",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should fall through to fallbackChain
      expect(result!.model).toBe("anthropic/claude-opus-4-5")
      expect(result!.source).toBe("provider-fallback")
    })

    test("userModel takes priority over categoryDefaultModel", () => {
      // #given - both userModel and categoryDefaultModel provided
      const input: ExtendedModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-5",
        categoryDefaultModel: "google/gemini-3-pro",
        fallbackChain: [
          { providers: ["google"], model: "gemini-3-pro" },
        ],
        availableModels: new Set(["google/gemini-3-pro-preview", "anthropic/claude-opus-4-5"]),
        systemDefaultModel: "system/default",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - userModel wins
      expect(result!.model).toBe("anthropic/claude-opus-4-5")
      expect(result!.source).toBe("override")
    })

    test("categoryDefaultModel works when availableModels is empty but connected provider exists", () => {
      // #given - no availableModels but connected provider cache exists
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(["google"])
      const input: ExtendedModelResolutionInput = {
        categoryDefaultModel: "google/gemini-3-pro",
        availableModels: new Set(),
        systemDefaultModel: "anthropic/claude-sonnet-4-5",
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then - should use categoryDefaultModel since google is connected
      expect(result!.model).toBe("google/gemini-3-pro")
      expect(result!.source).toBe("category-default")
      cacheSpy.mockRestore()
    })
  })

  describe("Optional systemDefaultModel", () => {
    test("returns undefined when systemDefaultModel is undefined and no fallback found", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic"], model: "nonexistent-model" },
        ],
        availableModels: new Set(["openai/gpt-5.2"]),
        systemDefaultModel: undefined,
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result).toBeUndefined()
    })

    test("returns undefined when no fallbackChain and systemDefaultModel is undefined", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        availableModels: new Set(["openai/gpt-5.2"]),
        systemDefaultModel: undefined,
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result).toBeUndefined()
    })

    test("still returns override when userModel provided even if systemDefaultModel undefined", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-5",
        availableModels: new Set(),
        systemDefaultModel: undefined,
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result).toBeDefined()
      expect(result!.model).toBe("anthropic/claude-opus-4-5")
      expect(result!.source).toBe("override")
    })

    test("still returns fallback match when systemDefaultModel undefined", () => {
      // #given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: ["anthropic"], model: "claude-opus-4-5" },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-5"]),
        systemDefaultModel: undefined,
      }

      // #when
      const result = resolveModelWithFallback(input)

      // #then
      expect(result).toBeDefined()
      expect(result!.model).toBe("anthropic/claude-opus-4-5")
      expect(result!.source).toBe("provider-fallback")
    })
  })
})

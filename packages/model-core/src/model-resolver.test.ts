// allow: SIZE_OK - legacy provider/model matrix with shared cache spies; add new resolver behavior in focused sibling tests instead.

import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS , SUPPORTED_VARIANTS } from "./registry";
import { describe, expect, test, spyOn, beforeEach, afterEach, mock } from "bun:test"

import { resolveModel, resolveModelWithFallback, type ModelResolutionInput, type ExtendedModelResolutionInput, type ModelResolutionResult } from "./model-resolver"
import { _setModelResolutionLogImplementationForTesting } from "./model-resolution-pipeline"
import * as connectedProvidersCache from "./connected-providers-cache"

const logMock = mock(() => {})

function expectResolved(result: ModelResolutionResult | undefined): ModelResolutionResult {
  if (result === undefined) {
    throw new Error("expected model resolution result")
  }
  return result
}

describe("resolveModel", () => {
  describe("priority chain", () => {
    test("returns userModel when all three are set", () => {
      // given
      const input: ModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-7",
        inheritedModel: "openai/gpt-5.4",
        systemDefault: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModel(input)

      // then
      expect(result).toBe("anthropic/claude-opus-4-7")
    })

    test("returns inheritedModel when userModel is undefined", () => {
      // given
      const input: ModelResolutionInput = {
        userModel: undefined,
        inheritedModel: "openai/gpt-5.4",
        systemDefault: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModel(input)

      // then
      expect(result).toBe("openai/gpt-5.4")
    })

    test("returns systemDefault when both userModel and inheritedModel are undefined", () => {
      // given
      const input: ModelResolutionInput = {
        userModel: undefined,
        inheritedModel: undefined,
        systemDefault: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModel(input)

      // then
      expect(result).toBe("google/gemini-3.1-pro")
    })
  })

  describe("empty string handling", () => {
    test("treats empty string as unset, uses fallback", () => {
      // given
      const input: ModelResolutionInput = {
        userModel: "",
        inheritedModel: "openai/gpt-5.4",
        systemDefault: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModel(input)

      // then
      expect(result).toBe("openai/gpt-5.4")
    })

    test("treats whitespace-only string as unset, uses fallback", () => {
      // given
      const input: ModelResolutionInput = {
        userModel: "   ",
        inheritedModel: "",
        systemDefault: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModel(input)

      // then
      expect(result).toBe("google/gemini-3.1-pro")
    })
  })

  describe("purity", () => {
    test("same input returns same output (referential transparency)", () => {
      // given
      const input: ModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-7",
        inheritedModel: "openai/gpt-5.4",
        systemDefault: "google/gemini-3.1-pro",
      }

      // when
      const result1 = resolveModel(input)
      const result2 = resolveModel(input)

      // then
      expect(result1).toBe(result2)
    })
  })
})

describe("resolveModelWithFallback", () => {
  beforeEach(() => {
    logMock.mockClear()
    _setModelResolutionLogImplementationForTesting(logMock)
  })

  afterEach(() => {
    _setModelResolutionLogImplementationForTesting(undefined)
  })

  describe("Step 1: UI Selection (highest priority)", () => {
    test("returns uiSelectedModel with override source when provided", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        uiSelectedModel: "opencode/big-pickle",
        userModel: "anthropic/claude-opus-4-7",
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_PROVIDERS.GITHUB_COPILOT], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-7", "github-copilot/claude-opus-4-7-preview"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("opencode/big-pickle")
      expect(resolved.source).toBe("override")
      expect(logMock).toHaveBeenCalledWith("Model resolved via UI selection", { model: "opencode/big-pickle" })
    })

    test("UI selection takes priority over config override", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        uiSelectedModel: "opencode/big-pickle",
        userModel: "anthropic/claude-opus-4-7",
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("opencode/big-pickle")
      expect(resolved.source).toBe("override")
    })

    test("whitespace-only uiSelectedModel is treated as not provided", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        uiSelectedModel: "   ",
        userModel: "anthropic/claude-opus-4-7",
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("anthropic/claude-opus-4-7")
      expect(logMock).toHaveBeenCalledWith("Model resolved via config override", { model: "anthropic/claude-opus-4-7" })
    })

    test("empty string uiSelectedModel falls through to config override", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        uiSelectedModel: "",
        userModel: "anthropic/claude-opus-4-7",
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("anthropic/claude-opus-4-7")
    })
  })

  describe("Step 2: Config Override", () => {
    test("returns userModel with override source when userModel is provided", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-7",
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_PROVIDERS.GITHUB_COPILOT], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-7", "github-copilot/claude-opus-4-7-preview"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("anthropic/claude-opus-4-7")
      expect(resolved.source).toBe("override")
      expect(logMock).toHaveBeenCalledWith("Model resolved via config override", { model: "anthropic/claude-opus-4-7" })
    })

    test("override takes priority even if model not in availableModels", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        userModel: "custom/my-model",
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("custom/my-model")
      expect(resolved.source).toBe("override")
    })

    test("whitespace-only userModel is treated as not provided", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        userModel: "   ",
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.source).not.toBe("override")
    })

    test("empty string userModel is treated as not provided", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        userModel: "",
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.source).not.toBe("override")
    })
  })

  describe("Step 3: Provider fallback chain", () => {
    test("tries providers in order within entry and returns first match", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_PROVIDERS.GITHUB_COPILOT, "opencode"], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels: new Set(["github-copilot/claude-opus-4-7-preview", "opencode/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("github-copilot/claude-opus-4-7-preview")
      expect(resolved.source).toBe("provider-fallback")
      expect(logMock).toHaveBeenCalledWith("Model resolved via fallback chain (availability confirmed)", {
        provider: SUPPORTED_PROVIDERS.GITHUB_COPILOT,
        model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7,
        match: "github-copilot/claude-opus-4-7-preview",
        variant: undefined,
      })
    })

    test("respects provider priority order within entry", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_PROVIDERS.GOOGLE], model: SUPPORTED_MODELS.GPT_5_4 },
        ],
        availableModels: new Set(["openai/gpt-5.4", "anthropic/claude-opus-4-7", "google/gemini-3.1-pro"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("openai/gpt-5.4")
      expect(resolved.source).toBe("provider-fallback")
    })

    test("tries next provider when first provider has no match", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC, "opencode"], model: SUPPORTED_MODELS.GPT_5_NANO },
        ],
        availableModels: new Set(["opencode/gpt-5-nano"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("opencode/gpt-5-nano")
      expect(resolved.source).toBe("provider-fallback")
    })

    test("uses fuzzy matching within provider", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_PROVIDERS.GITHUB_COPILOT], model: "claude-opus" },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-7", "github-copilot/claude-opus-4-7-preview"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("anthropic/claude-opus-4-7")
      expect(resolved.source).toBe("provider-fallback")
    })

    test("skips fallback chain when not provided", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.source).toBe("system-default")
    })

    test("skips fallback chain when empty", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [],
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.source).toBe("system-default")
    })

    test("case-insensitive fuzzy matching", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: "CLAUDE-OPUS" },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("anthropic/claude-opus-4-7")
      expect(resolved.source).toBe("provider-fallback")
    })
    test("cross-provider match tries next entry if no match found anywhere", () => {
      // given - first entry model not available anywhere, second entry available
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ZAI_CODING_PLAN], model: "nonexistent-model" },
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_SONNET_4_6 },
        ],
        availableModels: new Set(["anthropic/claude-sonnet-4-6"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - should fall through to second entry
      expect(resolved.model).toBe("anthropic/claude-sonnet-4-6")
      expect(resolved.source).toBe("provider-fallback")
    })
  })

  describe("Step 4: System default fallback (no availability match)", () => {
    test("returns system default when no availability match found in fallback chain", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: "nonexistent-model" },
        ],
        availableModels: new Set(["openai/gpt-5.4", "anthropic/claude-opus-4-7"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("google/gemini-3.1-pro")
      expect(resolved.source).toBe("system-default")
      expect(logMock).toHaveBeenCalledWith("No available model found in fallback chain, falling through to system default")
    })

    test("returns undefined when availableModels empty and no connected providers cache exists", () => {
      // given - both model cache and connected-providers cache are missing (first run)
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels: new Set(),
        systemDefaultModel: undefined, // no system default configured
      }

      // when
      const result = resolveModelWithFallback(input)

      // then - should return undefined to let OpenCode use Provider.defaultModel()
      expect(result).toBeUndefined()
      cacheSpy.mockRestore()
    })

    test("uses connected provider from fallback when availableModels empty but cache exists", () => {
      // given - model cache missing but connected-providers cache exists
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GOOGLE])
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels: new Set(),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - should use connected provider (openai) from fallback chain
      expect(resolved.model).toBe("openai/claude-opus-4-7")
      expect(resolved.source).toBe("provider-fallback")
      cacheSpy.mockRestore()
    })

    test("uses github-copilot when google not connected (visual-engineering scenario)", () => {
      // given - user has github-copilot but not google connected
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.GITHUB_COPILOT])
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.GOOGLE, SUPPORTED_PROVIDERS.GITHUB_COPILOT, "opencode"], model: SUPPORTED_MODELS.GEMINI_3_1_PRO },
        ],
        availableModels: new Set(),
        systemDefaultModel: "anthropic/claude-sonnet-4-6",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - should use github-copilot (second provider) since google not connected
      // model name is transformed to preview variant for github-copilot provider
      expect(resolved.model).toBe("github-copilot/gemini-3.1-pro-preview")
      expect(resolved.source).toBe("provider-fallback")
      cacheSpy.mockRestore()
    })

    test("falls through to system default when no provider in fallback is connected", () => {
      // given - user only has anthropic connected, but fallback chain has openai/opencode
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.ANTHROPIC])
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.OPENAI, "opencode"], model: SUPPORTED_MODELS.CLAUDE_HAIKU_4_5 },
        ],
        availableModels: new Set(),
        systemDefaultModel: "anthropic/claude-opus-4-7-20251101",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - no provider in fallback is connected, fall through to system default
      expect(resolved.model).toBe("anthropic/claude-opus-4-7-20251101")
      expect(resolved.source).toBe("system-default")
      cacheSpy.mockRestore()
    })

    test("falls through to system default when no cache and systemDefaultModel is provided", () => {
      // given - no cache but system default is configured
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue(null)
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels: new Set(),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - should fall through to system default
      expect(resolved.model).toBe("google/gemini-3.1-pro")
      expect(resolved.source).toBe("system-default")
      cacheSpy.mockRestore()
    })

    test("returns system default when fallbackChain is not provided", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        availableModels: new Set(["openai/gpt-5.4"]),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("google/gemini-3.1-pro")
      expect(resolved.source).toBe("system-default")
    })
  })

  describe("Multi-entry fallbackChain", () => {
    test("resolves to claude-opus when OpenAI unavailable but Anthropic available (oracle scenario)", () => {
      // given
      const availableModels = new Set(["anthropic/claude-opus-4-7"])

      // when
      const result = resolveModelWithFallback({
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.GITHUB_COPILOT, "opencode"], model: SUPPORTED_MODELS.GPT_5_4, variant: SUPPORTED_VARIANTS.HIGH },
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_PROVIDERS.GITHUB_COPILOT, "opencode"], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7, variant: SUPPORTED_VARIANTS.MAX },
        ],
        availableModels,
        systemDefaultModel: "system/default",
      })
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("anthropic/claude-opus-4-7")
      expect(resolved.source).toBe("provider-fallback")
    })

    test("tries all providers in first entry before moving to second entry", () => {
      // given
      const availableModels = new Set(["google/gemini-3.1-pro"])

      // when
      const result = resolveModelWithFallback({
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.OPENAI, SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.GPT_5_4 },
          { providers: [SUPPORTED_PROVIDERS.GOOGLE], model: SUPPORTED_MODELS.GEMINI_3_1_PRO },
        ],
        availableModels,
        systemDefaultModel: "system/default",
      })
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("google/gemini-3.1-pro")
      expect(resolved.source).toBe("provider-fallback")
    })

    test("returns first matching entry even if later entries have better matches", () => {
      // given
      const availableModels = new Set([
        "openai/gpt-5.4",
        "anthropic/claude-opus-4-7",
      ])

      // when
      const result = resolveModelWithFallback({
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4 },
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels,
        systemDefaultModel: "system/default",
      })
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("openai/gpt-5.4")
      expect(resolved.source).toBe("provider-fallback")
    })

    test("falls through to system default when none match availability", () => {
      // given
      const availableModels = new Set(["other/model"])

      // when
      const result = resolveModelWithFallback({
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.OPENAI], model: SUPPORTED_MODELS.GPT_5_4 },
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
          { providers: [SUPPORTED_PROVIDERS.GOOGLE], model: SUPPORTED_MODELS.GEMINI_3_1_PRO },
        ],
        availableModels,
        systemDefaultModel: "system/default",
      })
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("system/default")
      expect(resolved.source).toBe("system-default")
    })
  })

  describe("Type safety", () => {
    test("result has correct ModelResolutionResult shape", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-7",
        availableModels: new Set(),
        systemDefaultModel: "google/gemini-3.1-pro",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(typeof resolved.model).toBe("string")
      expect(["override", "provider-fallback", "system-default"]).toContain(resolved.source)
    })
  })

  describe("categoryDefaultModel (fuzzy matching for category defaults)", () => {
    test("applies fuzzy matching to categoryDefaultModel when userModel not provided", () => {
      // given - gemini-3.1-pro is the category default, but only gemini-3.1-pro-preview is available
      const input: ExtendedModelResolutionInput = {
        categoryDefaultModel: "google/gemini-3.1-pro",
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.GOOGLE, SUPPORTED_PROVIDERS.GITHUB_COPILOT, "opencode"], model: SUPPORTED_MODELS.GEMINI_3_1_PRO },
        ],
        availableModels: new Set(["google/gemini-3.1-pro-preview", "anthropic/claude-opus-4-7"]),
        systemDefaultModel: "anthropic/claude-sonnet-4-6",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - should fuzzy match gemini-3.1-pro → gemini-3.1-pro-preview
      expect(resolved.model).toBe("google/gemini-3.1-pro-preview")
      expect(resolved.source).toBe("category-default")
    })

    test("categoryDefaultModel uses exact match when available", () => {
      // given - exact match exists
      const input: ExtendedModelResolutionInput = {
        categoryDefaultModel: "google/gemini-3.1-pro",
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.GOOGLE], model: SUPPORTED_MODELS.GEMINI_3_1_PRO },
        ],
        availableModels: new Set(["google/gemini-3.1-pro", "google/gemini-3.1-pro-preview"]),
        systemDefaultModel: "anthropic/claude-sonnet-4-6",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - should use exact match
      expect(resolved.model).toBe("google/gemini-3.1-pro")
      expect(resolved.source).toBe("category-default")
    })

    test("categoryDefaultModel falls through to fallbackChain when no match in availableModels", () => {
      // given - categoryDefaultModel has no match, but fallbackChain does
      const input: ExtendedModelResolutionInput = {
        categoryDefaultModel: "google/gemini-3.1-pro",
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: "system/default",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - should fall through to fallbackChain
      expect(resolved.model).toBe("anthropic/claude-opus-4-7")
      expect(resolved.source).toBe("provider-fallback")
    })

    test("userModel takes priority over categoryDefaultModel", () => {
      // given - both userModel and categoryDefaultModel provided
      const input: ExtendedModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-7",
        categoryDefaultModel: "google/gemini-3.1-pro",
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.GOOGLE], model: SUPPORTED_MODELS.GEMINI_3_1_PRO },
        ],
        availableModels: new Set(["google/gemini-3.1-pro-preview", "anthropic/claude-opus-4-7"]),
        systemDefaultModel: "system/default",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - userModel wins
      expect(resolved.model).toBe("anthropic/claude-opus-4-7")
      expect(resolved.source).toBe("override")
    })

    test("categoryDefaultModel works when availableModels is empty but connected provider exists", () => {
      // given - no availableModels but connected provider cache exists
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.GOOGLE])
      const input: ExtendedModelResolutionInput = {
        categoryDefaultModel: "google/gemini-3.1-pro",
        availableModels: new Set(),
        systemDefaultModel: "anthropic/claude-sonnet-4-6",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - should use transformed categoryDefaultModel since google is connected
      expect(resolved.model).toBe("google/gemini-3.1-pro-preview")
      expect(resolved.source).toBe("category-default")
      cacheSpy.mockRestore()
    })

    test("transforms gemini-3-flash in categoryDefaultModel for google connected provider", () => {
      // given - google connected, category default uses gemini-3-flash
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.GOOGLE])
      const input: ExtendedModelResolutionInput = {
        categoryDefaultModel: "google/gemini-3-flash",
        availableModels: new Set(),
        systemDefaultModel: "anthropic/claude-sonnet-4-5",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - gemini-3-flash should be transformed to gemini-3-flash-preview
      expect(resolved.model).toBe("google/gemini-3-flash-preview")
      expect(resolved.source).toBe("category-default")
      cacheSpy.mockRestore()
    })

    test("does not double-transform categoryDefaultModel already containing -preview", () => {
      // given - category default already has -preview suffix
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.GOOGLE])
      const input: ExtendedModelResolutionInput = {
        categoryDefaultModel: "google/gemini-3.1-pro-preview",
        availableModels: new Set(),
        systemDefaultModel: "anthropic/claude-sonnet-4-5",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - should NOT become gemini-3.1-pro-preview-preview
      expect(resolved.model).toBe("google/gemini-3.1-pro-preview")
      expect(resolved.source).toBe("category-default")
      cacheSpy.mockRestore()
    })

    test("transforms gemini-3.1-pro in fallback chain for google connected provider", () => {
      // given - google connected, fallback chain has gemini-3.1-pro
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.GOOGLE])
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.GOOGLE, SUPPORTED_PROVIDERS.GITHUB_COPILOT], model: SUPPORTED_MODELS.GEMINI_3_1_PRO },
        ],
        availableModels: new Set(),
        systemDefaultModel: "anthropic/claude-sonnet-4-5",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - should transform to preview variant for google provider
      expect(resolved.model).toBe("google/gemini-3.1-pro-preview")
      expect(resolved.source).toBe("provider-fallback")
      cacheSpy.mockRestore()
    })

    test("passes through non-gemini-3 models for google connected provider", () => {
      // given - google connected, category default uses gemini-2.5-flash (no transform needed)
      const cacheSpy = spyOn(connectedProvidersCache, "readConnectedProvidersCache").mockReturnValue([SUPPORTED_PROVIDERS.GOOGLE])
      const input: ExtendedModelResolutionInput = {
        categoryDefaultModel: "google/gemini-2.5-flash",
        availableModels: new Set(),
        systemDefaultModel: "anthropic/claude-sonnet-4-5",
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then - should pass through unchanged
      expect(resolved.model).toBe("google/gemini-2.5-flash")
      expect(resolved.source).toBe("category-default")
      cacheSpy.mockRestore()
    })
  })

  describe("Optional systemDefaultModel", () => {
    test("returns undefined when systemDefaultModel is undefined and no fallback found", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: "nonexistent-model" },
        ],
        availableModels: new Set(["openai/gpt-5.4"]),
        systemDefaultModel: undefined,
      }

      // when
      const result = resolveModelWithFallback(input)

      // then
      expect(result).toBeUndefined()
    })

    test("returns undefined when no fallbackChain and systemDefaultModel is undefined", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        availableModels: new Set(["openai/gpt-5.4"]),
        systemDefaultModel: undefined,
      }

      // when
      const result = resolveModelWithFallback(input)

      // then
      expect(result).toBeUndefined()
    })

    test("still returns override when userModel provided even if systemDefaultModel undefined", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        userModel: "anthropic/claude-opus-4-7",
        availableModels: new Set(),
        systemDefaultModel: undefined,
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("anthropic/claude-opus-4-7")
      expect(resolved.source).toBe("override")
    })

    test("still returns fallback match when systemDefaultModel undefined", () => {
      // given
      const input: ExtendedModelResolutionInput = {
        fallbackChain: [
          { providers: [SUPPORTED_PROVIDERS.ANTHROPIC], model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
        ],
        availableModels: new Set(["anthropic/claude-opus-4-7"]),
        systemDefaultModel: undefined,
      }

      // when
      const result = resolveModelWithFallback(input)
      const resolved = expectResolved(result)

      // then
      expect(resolved.model).toBe("anthropic/claude-opus-4-7")
      expect(resolved.source).toBe("provider-fallback")
    })
  })
})

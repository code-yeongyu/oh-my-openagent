import { SUPPORTED_PROVIDERS, SUPPORTED_MODELS } from "@oh-my-opencode/model-core";
import { describe, expect, test } from "bun:test"

import {
  transformModelForProvider as transformRuntimeModelForProvider,
  transformModelForProviderDisplay as transformModelForProvider,
} from "@oh-my-opencode/model-core"

describe("transformModelForProvider", () => {
  describe("github-copilot provider", () => {
    test("transforms claude-opus-4-7 to claude-opus-4.7", () => {
      // #given github-copilot provider and claude-opus-4-7 model
      const provider = SUPPORTED_PROVIDERS.GITHUB_COPILOT
      const model = SUPPORTED_MODELS.CLAUDE_OPUS_4_7

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to claude-opus-4.7
      expect(result).toBe("claude-opus-4.7")
    })

    test("transforms claude-sonnet-4-5 to claude-sonnet-4.5", () => {
      // #given github-copilot provider and claude-sonnet-4-5 model
      const provider = SUPPORTED_PROVIDERS.GITHUB_COPILOT
      const model = "claude-sonnet-4-5"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to claude-sonnet-4.5
      expect(result).toBe("claude-sonnet-4.5")
    })

    test("transforms claude-haiku-4-5 to claude-haiku-4.5", () => {
      // #given github-copilot provider and claude-haiku-4-5 model
      const provider = SUPPORTED_PROVIDERS.GITHUB_COPILOT
      const model = SUPPORTED_MODELS.CLAUDE_HAIKU_4_5

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to claude-haiku-4.5
      expect(result).toBe("claude-haiku-4.5")
    })

    test("transforms gemini-3.1-pro to gemini-3.1-pro-preview", () => {
      // #given github-copilot provider and gemini-3.1-pro model
      const provider = SUPPORTED_PROVIDERS.GITHUB_COPILOT
      const model = SUPPORTED_MODELS.GEMINI_3_1_PRO

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to gemini-3.1-pro-preview
      expect(result).toBe("gemini-3.1-pro-preview")
    })

    test("transforms gemini-3-flash to gemini-3-flash-preview", () => {
      // #given github-copilot provider and gemini-3-flash model
      const provider = SUPPORTED_PROVIDERS.GITHUB_COPILOT
      const model = SUPPORTED_MODELS.GEMINI_3_FLASH

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to gemini-3-flash-preview
      expect(result).toBe("gemini-3-flash-preview")
    })

    test("prevents double transformation of gemini-3.1-pro-preview", () => {
      // #given github-copilot provider and gemini-3.1-pro-preview model (already transformed)
      const provider = SUPPORTED_PROVIDERS.GITHUB_COPILOT
      const model = "gemini-3.1-pro-preview"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should NOT become gemini-3.1-pro-preview-preview
      expect(result).toBe("gemini-3.1-pro-preview")
    })

    test("prevents double transformation of gemini-3-flash-preview", () => {
      // #given github-copilot provider and gemini-3-flash-preview model (already transformed)
      const provider = SUPPORTED_PROVIDERS.GITHUB_COPILOT
      const model = "gemini-3-flash-preview"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should NOT become gemini-3-flash-preview-preview
      expect(result).toBe("gemini-3-flash-preview")
    })
  })

  describe("google provider", () => {
    test("transforms gemini-3-flash to gemini-3-flash-preview", () => {
      // #given google provider and gemini-3-flash model
      const provider = SUPPORTED_PROVIDERS.GOOGLE
      const model = SUPPORTED_MODELS.GEMINI_3_FLASH

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to gemini-3-flash-preview
      expect(result).toBe("gemini-3-flash-preview")
    })

    test("transforms gemini-3.1-pro to gemini-3.1-pro-preview", () => {
      // #given google provider and gemini-3.1-pro model
      const provider = SUPPORTED_PROVIDERS.GOOGLE
      const model = SUPPORTED_MODELS.GEMINI_3_1_PRO

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to gemini-3.1-pro-preview
      expect(result).toBe("gemini-3.1-pro-preview")
    })

    test("passes through other gemini models unchanged", () => {
      // #given google provider and gemini-2.5-flash model
      const provider = SUPPORTED_PROVIDERS.GOOGLE
      const model = "gemini-2.5-flash"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should pass through unchanged
      expect(result).toBe("gemini-2.5-flash")
    })

    test("prevents double transformation of gemini-3-flash-preview", () => {
      // #given google provider and gemini-3-flash-preview model (already transformed)
      const provider = SUPPORTED_PROVIDERS.GOOGLE
      const model = "gemini-3-flash-preview"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should NOT become gemini-3-flash-preview-preview
      expect(result).toBe("gemini-3-flash-preview")
    })

    test("prevents double transformation of gemini-3.1-pro-preview", () => {
      // #given google provider and gemini-3.1-pro-preview model (already transformed)
      const provider = SUPPORTED_PROVIDERS.GOOGLE
      const model = "gemini-3.1-pro-preview"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should NOT become gemini-3.1-pro-preview-preview
      expect(result).toBe("gemini-3.1-pro-preview")
    })

    test("does not transform claude models for google provider", () => {
      // #given google provider and claude-opus-4-7 model
      const provider = SUPPORTED_PROVIDERS.GOOGLE
      const model = SUPPORTED_MODELS.CLAUDE_OPUS_4_7

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should pass through unchanged (google doesn't use claude)
      expect(result).toBe(SUPPORTED_MODELS.CLAUDE_OPUS_4_7)
    })
  })

  describe("anthropic provider", () => {
    test("preserves hyphenated claude-opus-4-7 for config output (regression: installer must not write dotted IDs)", () => {
      // #given anthropic provider and claude-opus-4-7 model
      const provider = SUPPORTED_PROVIDERS.ANTHROPIC
      const model = SUPPORTED_MODELS.CLAUDE_OPUS_4_7

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should keep hyphenated form so Anthropic provider resolution succeeds on fresh installs
      expect(result).toBe(SUPPORTED_MODELS.CLAUDE_OPUS_4_7)
    })

    test("preserves hyphenated claude-sonnet-4-6 for config output", () => {
      // #given anthropic provider and claude-sonnet-4-6 model
      const provider = SUPPORTED_PROVIDERS.ANTHROPIC
      const model = SUPPORTED_MODELS.CLAUDE_SONNET_4_6

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should keep hyphenated form
      expect(result).toBe(SUPPORTED_MODELS.CLAUDE_SONNET_4_6)
    })

    test("preserves hyphenated claude-haiku-4-5 for config output", () => {
      // #given anthropic provider and claude-haiku-4-5 model
      const provider = SUPPORTED_PROVIDERS.ANTHROPIC
      const model = SUPPORTED_MODELS.CLAUDE_HAIKU_4_5

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should keep hyphenated form
      expect(result).toBe(SUPPORTED_MODELS.CLAUDE_HAIKU_4_5)
    })
  })

  describe("vercel provider", () => {
    test("prepends anthropic/ and applies anthropic transform for claude models", () => {
      // #given vercel provider and claude-opus-4-7 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, SUPPORTED_MODELS.CLAUDE_OPUS_4_7)

      // #then should produce anthropic/claude-opus-4.7
      expect(result).toBe("anthropic/claude-opus-4.7")
    })

    test("prepends anthropic/ and applies anthropic transform for claude-sonnet", () => {
      // #given vercel provider and claude-sonnet-4-6 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, SUPPORTED_MODELS.CLAUDE_SONNET_4_6)

      // #then should produce anthropic/claude-sonnet-4.6
      expect(result).toBe("anthropic/claude-sonnet-4.6")
    })

    test("prepends anthropic/ and applies anthropic transform for claude-haiku", () => {
      // #given vercel provider and claude-haiku-4-5 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, SUPPORTED_MODELS.CLAUDE_HAIKU_4_5)

      // #then should produce anthropic/claude-haiku-4.5
      expect(result).toBe("anthropic/claude-haiku-4.5")
    })

    test("prepends openai/ for gpt models", () => {
      // #given vercel provider and gpt-5.4 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, SUPPORTED_MODELS.GPT_5_4)

      // #then should produce openai/gpt-5.4
      expect(result).toBe("openai/gpt-5.4")
    })

    test("prepends google/ and applies google transform for gemini models", () => {
      // #given vercel provider and gemini-3.1-pro model
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, SUPPORTED_MODELS.GEMINI_3_1_PRO)

      // #then should produce google/gemini-3.1-pro-preview
      expect(result).toBe("google/gemini-3.1-pro-preview")
    })

    test("prepends google/ without -preview for gemini-3-flash", () => {
      // #given vercel provider and gemini-3-flash model
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, SUPPORTED_MODELS.GEMINI_3_FLASH)

      // #then should produce google/gemini-3-flash (gateway does not use -preview for this model)
      expect(result).toBe("google/gemini-3-flash")
    })

    test("prepends xai/ for grok models", () => {
      // #given vercel provider and grok-code-fast-1 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, "grok-code-fast-1")

      // #then should produce xai/grok-code-fast-1
      expect(result).toBe("xai/grok-code-fast-1")
    })

    test("delegates to sub-provider when model already has sub-provider prefix", () => {
      // #given vercel provider and anthropic/claude-opus-4-7 (already prefixed)
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, "anthropic/claude-opus-4-7")

      // #then should apply anthropic transform within the prefix
      expect(result).toBe("anthropic/claude-opus-4.7")
    })

    test("prepends minimax/ for minimax models", () => {
      // #given vercel provider and minimax-m2.7 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, SUPPORTED_MODELS.MINIMAX_M2_7)

      // #then should produce minimax/minimax-m2.7
      expect(result).toBe("minimax/minimax-m2.7")
    })

    test("prepends moonshotai/ for kimi models", () => {
      // #given vercel provider and kimi-k2.5 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, SUPPORTED_MODELS.KIMI_K2_5)

      // #then should produce moonshotai/kimi-k2.5
      expect(result).toBe("moonshotai/kimi-k2.5")
    })

    test("prepends zai/ for glm models", () => {
      // #given vercel provider and glm-5 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, SUPPORTED_MODELS.GLM_5)

      // #then should produce zai/glm-5
      expect(result).toBe("zai/glm-5")
    })

    test("passes through unknown models without sub-provider prefix", () => {
      // #given vercel provider and an unknown model name
      // #when transformModelForProvider is called
      const result = transformModelForProvider(SUPPORTED_PROVIDERS.VERCEL, SUPPORTED_MODELS.BIG_PICKLE)

      // #then should pass through unchanged
      expect(result).toBe(SUPPORTED_MODELS.BIG_PICKLE)
    })
  })

  describe("unknown provider", () => {
    test("passes model through unchanged for unknown provider", () => {
      // #given unknown provider and any model
      const provider = "unknown-provider"
      const model = "some-model"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should pass through unchanged
      expect(result).toBe("some-model")
    })

    test("passes gemini-3-flash through unchanged for unknown provider", () => {
      // #given unknown provider and gemini-3-flash model
      const provider = "unknown-provider"
      const model = SUPPORTED_MODELS.GEMINI_3_FLASH

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should pass through unchanged (no transformation for unknown provider)
      expect(result).toBe(SUPPORTED_MODELS.GEMINI_3_FLASH)
    })
  })

  test("uses separate display and runtime transform implementations", () => {
    // #given the display transform (used by the installer) and the runtime transform
    const cliResult = transformModelForProvider(SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_MODELS.CLAUDE_OPUS_4_7)
    const runtimeResult = transformRuntimeModelForProvider(SUPPORTED_PROVIDERS.ANTHROPIC, SUPPORTED_MODELS.CLAUDE_OPUS_4_7)
    const nonAnthropicScenarios = [
      { provider: SUPPORTED_PROVIDERS.OPENAI, model: SUPPORTED_MODELS.GPT_4O },
      { provider: SUPPORTED_PROVIDERS.GOOGLE, model: "gemini-2.5-pro" },
      { provider: SUPPORTED_PROVIDERS.GITHUB_COPILOT, model: SUPPORTED_MODELS.GEMINI_3_FLASH },
      { provider: SUPPORTED_PROVIDERS.VERCEL, model: SUPPORTED_MODELS.CLAUDE_OPUS_4_7 },
    ] as const

    // #when both are called with the same anthropic claude input
    // #then both preserve hyphenated form for direct Anthropic calls
    expect(transformModelForProvider).not.toBe(transformRuntimeModelForProvider)
    expect(cliResult).toBe(SUPPORTED_MODELS.CLAUDE_OPUS_4_7)
    expect(runtimeResult).toBe(SUPPORTED_MODELS.CLAUDE_OPUS_4_7)

    for (const scenario of nonAnthropicScenarios) {
      expect(transformModelForProvider(scenario.provider, scenario.model)).toBe(
        transformRuntimeModelForProvider(scenario.provider, scenario.model),
      )
    }
  })
})

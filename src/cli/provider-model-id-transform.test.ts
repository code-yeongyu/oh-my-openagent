import { describe, expect, test } from "bun:test"

import { transformModelForProvider } from "./provider-model-id-transform"
import { transformModelForProvider as transformSharedModelForProvider } from "../shared/provider-model-id-transform"

describe("transformModelForProvider", () => {
  describe("github-copilot provider", () => {
    test("transforms claude-opus-4-6 to claude-opus-4.6", () => {
      // #given github-copilot provider and claude-opus-4-6 model
      const provider = "github-copilot"
      const model = "claude-opus-4-6"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to claude-opus-4.6
      expect(result).toBe("claude-opus-4.6")
    })

    test("transforms claude-sonnet-4-5 to claude-sonnet-4.5", () => {
      // #given github-copilot provider and claude-sonnet-4-5 model
      const provider = "github-copilot"
      const model = "claude-sonnet-4-5"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to claude-sonnet-4.5
      expect(result).toBe("claude-sonnet-4.5")
    })

    test("transforms claude-haiku-4-5 to claude-haiku-4.5", () => {
      // #given github-copilot provider and claude-haiku-4-5 model
      const provider = "github-copilot"
      const model = "claude-haiku-4-5"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to claude-haiku-4.5
      expect(result).toBe("claude-haiku-4.5")
    })

    test("transforms gemini-3.1-pro to gemini-3.1-pro-preview", () => {
      // #given github-copilot provider and gemini-3.1-pro model
      const provider = "github-copilot"
      const model = "gemini-3.1-pro"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to gemini-3.1-pro-preview
      expect(result).toBe("gemini-3.1-pro-preview")
    })

    test("transforms gemini-3-flash to gemini-3-flash-preview", () => {
      // #given github-copilot provider and gemini-3-flash model
      const provider = "github-copilot"
      const model = "gemini-3-flash"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to gemini-3-flash-preview
      expect(result).toBe("gemini-3-flash-preview")
    })

    test("prevents double transformation of gemini-3.1-pro-preview", () => {
      // #given github-copilot provider and gemini-3.1-pro-preview model (already transformed)
      const provider = "github-copilot"
      const model = "gemini-3.1-pro-preview"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should NOT become gemini-3.1-pro-preview-preview
      expect(result).toBe("gemini-3.1-pro-preview")
    })

    test("prevents double transformation of gemini-3-flash-preview", () => {
      // #given github-copilot provider and gemini-3-flash-preview model (already transformed)
      const provider = "github-copilot"
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
      const provider = "google"
      const model = "gemini-3-flash"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to gemini-3-flash-preview
      expect(result).toBe("gemini-3-flash-preview")
    })

    test("transforms gemini-3.1-pro to gemini-3.1-pro-preview", () => {
      // #given google provider and gemini-3.1-pro model
      const provider = "google"
      const model = "gemini-3.1-pro"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should transform to gemini-3.1-pro-preview
      expect(result).toBe("gemini-3.1-pro-preview")
    })

    test("passes through other gemini models unchanged", () => {
      // #given google provider and gemini-2.5-flash model
      const provider = "google"
      const model = "gemini-2.5-flash"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should pass through unchanged
      expect(result).toBe("gemini-2.5-flash")
    })

    test("prevents double transformation of gemini-3-flash-preview", () => {
      // #given google provider and gemini-3-flash-preview model (already transformed)
      const provider = "google"
      const model = "gemini-3-flash-preview"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should NOT become gemini-3-flash-preview-preview
      expect(result).toBe("gemini-3-flash-preview")
    })

    test("prevents double transformation of gemini-3.1-pro-preview", () => {
      // #given google provider and gemini-3.1-pro-preview model (already transformed)
      const provider = "google"
      const model = "gemini-3.1-pro-preview"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should NOT become gemini-3.1-pro-preview-preview
      expect(result).toBe("gemini-3.1-pro-preview")
    })

    test("does not transform claude models for google provider", () => {
      // #given google provider and claude-opus-4-6 model
      const provider = "google"
      const model = "claude-opus-4-6"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should pass through unchanged (google doesn't use claude)
      expect(result).toBe("claude-opus-4-6")
    })
  })

  describe("anthropic provider", () => {
    test("preserves hyphenated claude-opus-4-6 for config output (regression: installer must not write dotted IDs)", () => {
      // #given anthropic provider and claude-opus-4-6 model
      const provider = "anthropic"
      const model = "claude-opus-4-6"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should keep hyphenated form so Anthropic provider resolution succeeds on fresh installs
      expect(result).toBe("claude-opus-4-6")
    })

    test("preserves hyphenated claude-sonnet-4-6 for config output", () => {
      // #given anthropic provider and claude-sonnet-4-6 model
      const provider = "anthropic"
      const model = "claude-sonnet-4-6"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should keep hyphenated form
      expect(result).toBe("claude-sonnet-4-6")
    })

    test("preserves hyphenated claude-haiku-4-5 for config output", () => {
      // #given anthropic provider and claude-haiku-4-5 model
      const provider = "anthropic"
      const model = "claude-haiku-4-5"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should keep hyphenated form
      expect(result).toBe("claude-haiku-4-5")
    })
  })

  describe("vercel provider", () => {
    test("prepends anthropic/ and applies anthropic transform for claude models", () => {
      // #given vercel provider and claude-opus-4-6 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "claude-opus-4-6")

      // #then should produce anthropic/claude-opus-4.6
      expect(result).toBe("anthropic/claude-opus-4.6")
    })

    test("prepends anthropic/ and applies anthropic transform for claude-sonnet", () => {
      // #given vercel provider and claude-sonnet-4-6 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "claude-sonnet-4-6")

      // #then should produce anthropic/claude-sonnet-4.6
      expect(result).toBe("anthropic/claude-sonnet-4.6")
    })

    test("prepends anthropic/ and applies anthropic transform for claude-haiku", () => {
      // #given vercel provider and claude-haiku-4-5 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "claude-haiku-4-5")

      // #then should produce anthropic/claude-haiku-4.5
      expect(result).toBe("anthropic/claude-haiku-4.5")
    })

    test("prepends openai/ for gpt models", () => {
      // #given vercel provider and gpt-5.4 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "gpt-5.4")

      // #then should produce openai/gpt-5.4
      expect(result).toBe("openai/gpt-5.4")
    })

    test("prepends google/ and applies google transform for gemini models", () => {
      // #given vercel provider and gemini-3.1-pro model
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "gemini-3.1-pro")

      // #then should produce google/gemini-3.1-pro-preview
      expect(result).toBe("google/gemini-3.1-pro-preview")
    })

    test("prepends google/ without -preview for gemini-3-flash", () => {
      // #given vercel provider and gemini-3-flash model
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "gemini-3-flash")

      // #then should produce google/gemini-3-flash (gateway does not use -preview for this model)
      expect(result).toBe("google/gemini-3-flash")
    })

    test("prepends xai/ for grok models", () => {
      // #given vercel provider and grok-code-fast-1 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "grok-code-fast-1")

      // #then should produce xai/grok-code-fast-1
      expect(result).toBe("xai/grok-code-fast-1")
    })

    test("delegates to sub-provider when model already has sub-provider prefix", () => {
      // #given vercel provider and anthropic/claude-opus-4-6 (already prefixed)
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "anthropic/claude-opus-4-6")

      // #then should apply anthropic transform within the prefix
      expect(result).toBe("anthropic/claude-opus-4.6")
    })

    test("prepends minimax/ for minimax models", () => {
      // #given vercel provider and minimax-m2.7 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "minimax-m2.7")

      // #then should produce minimax/minimax-m2.7
      expect(result).toBe("minimax/minimax-m2.7")
    })

    test("prepends moonshotai/ for kimi models", () => {
      // #given vercel provider and kimi-k2.5 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "kimi-k2.5")

      // #then should produce moonshotai/kimi-k2.5
      expect(result).toBe("moonshotai/kimi-k2.5")
    })

    test("prepends zai/ for glm models", () => {
      // #given vercel provider and glm-5 model
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "glm-5")

      // #then should produce zai/glm-5
      expect(result).toBe("zai/glm-5")
    })

    test("passes through unknown models without sub-provider prefix", () => {
      // #given vercel provider and an unknown model name
      // #when transformModelForProvider is called
      const result = transformModelForProvider("vercel", "big-pickle")

      // #then should pass through unchanged
      expect(result).toBe("big-pickle")
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
      const model = "gemini-3-flash"

      // #when transformModelForProvider is called
      const result = transformModelForProvider(provider, model)

      // #then should pass through unchanged (no transformation for unknown provider)
      expect(result).toBe("gemini-3-flash")
    })
  })

  test("uses a CLI-local transform implementation distinct from the shared runtime transform", () => {
    // #given the CLI transform (used by the installer) and the shared runtime transform
    const cliResult = transformModelForProvider("anthropic", "claude-opus-4-6")
    const sharedResult = transformSharedModelForProvider("anthropic", "claude-opus-4-6")

    // #when both are called with the same anthropic claude input
    // #then the CLI preserves hyphenated form for config output,
    //       the shared runtime transform converts dash→dot for API calls
    expect(transformModelForProvider).not.toBe(transformSharedModelForProvider)
    expect(cliResult).toBe("claude-opus-4-6")
    expect(sharedResult).toBe("claude-opus-4.6")
  })
})

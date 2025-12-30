import { describe, expect, it } from "bun:test"
import {
  getHighVariant,
  getThinkingConfig,
  isAlreadyHighVariant,
  THINKING_CONFIGS,
} from "./switcher"

describe("think-mode switcher", () => {
  describe("GitHub Copilot provider support", () => {
    describe("Claude models via github-copilot", () => {
      it("should resolve github-copilot Claude Opus to anthropic config", () => {
        // #given a github-copilot provider with Claude Opus model
        const providerID = "github-copilot"
        const modelID = "claude-opus-4-5"

        // #when getting thinking config
        const config = getThinkingConfig(providerID, modelID)

        // #then should return anthropic thinking config
        expect(config).not.toBeNull()
        expect(config?.thinking).toBeDefined()
        expect((config?.thinking as Record<string, unknown>)?.type).toBe(
          "enabled"
        )
        expect((config?.thinking as Record<string, unknown>)?.budgetTokens).toBe(
          64000
        )
      })

      it("should resolve github-copilot Claude Sonnet to anthropic config", () => {
        // #given a github-copilot provider with Claude Sonnet model
        const config = getThinkingConfig("github-copilot", "claude-sonnet-4-5")

        // #then should return anthropic thinking config
        expect(config).not.toBeNull()
        expect(config?.thinking).toBeDefined()
      })

      it("should handle Claude with dots in version number", () => {
        // #given a model ID with dots (claude-opus-4.5)
        const config = getThinkingConfig("github-copilot", "claude-opus-4.5")

        // #then should still return anthropic thinking config
        expect(config).not.toBeNull()
        expect(config?.thinking).toBeDefined()
      })
    })

    describe("Gemini models via github-copilot", () => {
      it("should resolve github-copilot Gemini Pro to google config", () => {
        // #given a github-copilot provider with Gemini Pro model
        const config = getThinkingConfig("github-copilot", "gemini-3-pro-preview")

        // #then should return google thinking config
        expect(config).not.toBeNull()
        expect(config?.providerOptions).toBeDefined()
        const googleOptions = (
          config?.providerOptions as Record<string, unknown>
        )?.google as Record<string, unknown>
        expect(googleOptions?.thinkingConfig).toBeDefined()
      })

      it("should resolve github-copilot Gemini Flash to google config", () => {
        // #given a github-copilot provider with Gemini Flash model
        const config = getThinkingConfig(
          "github-copilot",
          "gemini-3-flash-preview"
        )

        // #then should return google thinking config
        expect(config).not.toBeNull()
        expect(config?.providerOptions).toBeDefined()
      })
    })

    describe("GPT models via github-copilot", () => {
      it("should resolve github-copilot GPT-5.2 to openai config", () => {
        // #given a github-copilot provider with GPT-5.2 model
        const config = getThinkingConfig("github-copilot", "gpt-5.2")

        // #then should return openai thinking config
        expect(config).not.toBeNull()
        expect(config?.reasoning_effort).toBe("high")
      })

      it("should resolve github-copilot GPT-5 to openai config", () => {
        // #given a github-copilot provider with GPT-5 model
        const config = getThinkingConfig("github-copilot", "gpt-5")

        // #then should return openai thinking config
        expect(config).not.toBeNull()
        expect(config?.reasoning_effort).toBe("high")
      })

      it("should resolve github-copilot o1 to openai config", () => {
        // #given a github-copilot provider with o1 model
        const config = getThinkingConfig("github-copilot", "o1-preview")

        // #then should return openai thinking config
        expect(config).not.toBeNull()
        expect(config?.reasoning_effort).toBe("high")
      })

      it("should resolve github-copilot o3 to openai config", () => {
        // #given a github-copilot provider with o3 model
        const config = getThinkingConfig("github-copilot", "o3-mini")

        // #then should return openai thinking config
        expect(config).not.toBeNull()
        expect(config?.reasoning_effort).toBe("high")
      })
    })

    describe("Unknown models via github-copilot", () => {
      it("should return null for unknown model types", () => {
        // #given a github-copilot provider with unknown model
        const config = getThinkingConfig("github-copilot", "llama-3-70b")

        // #then should return null (no matching provider)
        expect(config).toBeNull()
      })
    })
  })

  describe("Model ID normalization", () => {
    describe("getHighVariant with dots vs hyphens", () => {
      it("should handle dots in Claude version numbers", () => {
        // #given a Claude model ID with dot format
        const variant = getHighVariant("claude-opus-4.5")

        // #then should return high variant with hyphen format
        expect(variant).toBe("claude-opus-4-5-high")
      })

      it("should handle hyphens in Claude version numbers", () => {
        // #given a Claude model ID with hyphen format
        const variant = getHighVariant("claude-opus-4-5")

        // #then should return high variant
        expect(variant).toBe("claude-opus-4-5-high")
      })

      it("should handle dots in GPT version numbers", () => {
        // #given a GPT model ID with dot format (gpt-5.2)
        const variant = getHighVariant("gpt-5.2")

        // #then should return high variant
        expect(variant).toBe("gpt-5-2-high")
      })

      it("should handle dots in GPT-5.1 codex variants", () => {
        // #given a GPT-5.1-codex model ID
        const variant = getHighVariant("gpt-5.1-codex")

        // #then should return high variant
        expect(variant).toBe("gpt-5-1-codex-high")
      })

      it("should handle Gemini preview variants", () => {
        // #given Gemini preview model IDs
        expect(getHighVariant("gemini-3-pro-preview")).toBe(
          "gemini-3-pro-preview-high"
        )
        expect(getHighVariant("gemini-3-flash-preview")).toBe(
          "gemini-3-flash-preview-high"
        )
      })

      it("should return null for already-high variants", () => {
        // #given model IDs that are already high variants
        expect(getHighVariant("claude-opus-4-5-high")).toBeNull()
        expect(getHighVariant("gpt-5-2-high")).toBeNull()
        expect(getHighVariant("gemini-3-pro-high")).toBeNull()
      })

      it("should return null for unknown models", () => {
        // #given unknown model IDs
        expect(getHighVariant("llama-3-70b")).toBeNull()
        expect(getHighVariant("mistral-large")).toBeNull()
      })
    })
  })

  describe("isAlreadyHighVariant", () => {
    it("should detect -high suffix", () => {
      // #given model IDs with -high suffix
      expect(isAlreadyHighVariant("claude-opus-4-5-high")).toBe(true)
      expect(isAlreadyHighVariant("gpt-5-2-high")).toBe(true)
      expect(isAlreadyHighVariant("gemini-3-pro-high")).toBe(true)
    })

    it("should detect -high suffix after normalization", () => {
      // #given model IDs with dots that end in -high
      expect(isAlreadyHighVariant("gpt-5.2-high")).toBe(true)
    })

    it("should return false for base models", () => {
      // #given base model IDs without -high suffix
      expect(isAlreadyHighVariant("claude-opus-4-5")).toBe(false)
      expect(isAlreadyHighVariant("claude-opus-4.5")).toBe(false)
      expect(isAlreadyHighVariant("gpt-5.2")).toBe(false)
      expect(isAlreadyHighVariant("gemini-3-pro")).toBe(false)
    })

    it("should return false for models with 'high' in name but not suffix", () => {
      // #given model IDs that contain 'high' but not as suffix
      expect(isAlreadyHighVariant("high-performance-model")).toBe(false)
    })
  })

  describe("getThinkingConfig", () => {
    describe("Already high variants", () => {
      it("should return null for already-high variants", () => {
        // #given already-high model variants
        expect(
          getThinkingConfig("anthropic", "claude-opus-4-5-high")
        ).toBeNull()
        expect(getThinkingConfig("openai", "gpt-5-2-high")).toBeNull()
        expect(getThinkingConfig("google", "gemini-3-pro-high")).toBeNull()
      })

      it("should return null for already-high variants via github-copilot", () => {
        // #given already-high model variants via github-copilot
        expect(
          getThinkingConfig("github-copilot", "claude-opus-4-5-high")
        ).toBeNull()
        expect(getThinkingConfig("github-copilot", "gpt-5.2-high")).toBeNull()
      })
    })

    describe("Non-thinking-capable models", () => {
      it("should return null for non-thinking-capable models", () => {
        // #given models that don't support thinking mode
        expect(getThinkingConfig("anthropic", "claude-2")).toBeNull()
        expect(getThinkingConfig("openai", "gpt-4")).toBeNull()
        expect(getThinkingConfig("google", "gemini-1")).toBeNull()
      })
    })

    describe("Unknown providers", () => {
      it("should return null for unknown providers", () => {
        // #given unknown provider IDs
        expect(getThinkingConfig("unknown-provider", "some-model")).toBeNull()
        expect(getThinkingConfig("azure", "gpt-5")).toBeNull()
      })
    })
  })

  describe("Direct provider configs (backwards compatibility)", () => {
    it("should still work for direct anthropic provider", () => {
      // #given direct anthropic provider
      const config = getThinkingConfig("anthropic", "claude-opus-4-5")

      // #then should return anthropic thinking config
      expect(config).not.toBeNull()
      expect(config?.thinking).toBeDefined()
      expect((config?.thinking as Record<string, unknown>)?.type).toBe("enabled")
    })

    it("should still work for direct google provider", () => {
      // #given direct google provider
      const config = getThinkingConfig("google", "gemini-3-pro")

      // #then should return google thinking config
      expect(config).not.toBeNull()
      expect(config?.providerOptions).toBeDefined()
    })

    it("should still work for amazon-bedrock provider", () => {
      // #given amazon-bedrock provider with claude model
      const config = getThinkingConfig("amazon-bedrock", "claude-sonnet-4-5")

      // #then should return bedrock thinking config
      expect(config).not.toBeNull()
      expect(config?.reasoningConfig).toBeDefined()
    })

    it("should still work for google-vertex provider", () => {
      // #given google-vertex provider
      const config = getThinkingConfig("google-vertex", "gemini-3-pro")

      // #then should return google-vertex thinking config
      expect(config).not.toBeNull()
      expect(config?.providerOptions).toBeDefined()
      const vertexOptions = (config?.providerOptions as Record<string, unknown>)?.[
        "google-vertex"
      ] as Record<string, unknown>
      expect(vertexOptions?.thinkingConfig).toBeDefined()
    })

    it("should work for direct openai provider", () => {
      // #given direct openai provider
      const config = getThinkingConfig("openai", "gpt-5")

      // #then should return openai thinking config
      expect(config).not.toBeNull()
      expect(config?.reasoning_effort).toBe("high")
    })
  })

  describe("THINKING_CONFIGS structure", () => {
    it("should have correct structure for anthropic", () => {
      const config = THINKING_CONFIGS.anthropic
      expect(config.thinking).toBeDefined()
      expect(config.maxTokens).toBe(128000)
    })

    it("should have correct structure for google", () => {
      const config = THINKING_CONFIGS.google
      expect(config.providerOptions).toBeDefined()
    })

    it("should have correct structure for openai", () => {
      const config = THINKING_CONFIGS.openai
      expect(config.reasoning_effort).toBe("high")
    })

    it("should have correct structure for amazon-bedrock", () => {
      const config = THINKING_CONFIGS["amazon-bedrock"]
      expect(config.reasoningConfig).toBeDefined()
      expect(config.maxTokens).toBe(64000)
    })
  })
})

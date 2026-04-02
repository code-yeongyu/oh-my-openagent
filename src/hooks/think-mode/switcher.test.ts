import { describe, expect, it } from "bun:test"
import {
  getHighVariant,
  isAlreadyHighVariant,
} from "./switcher"

/**
 * DEPRECATION NOTICE:
 *
 * getHighVariant() is no longer used by the think-mode hook.
 * The hook now only sets output.message.variant = "high" and lets
 * OpenCode's native variant system handle the transformation.
 *
 * This function is kept for:
 * - Potential future validation use
 * - Backward compatibility for external consumers
 *
 * Tests verify the function still works correctly.
 */

describe("think-mode switcher", () => {
  describe("Model ID normalization", () => {
    describe("getHighVariant with dots vs hyphens", () => {
      it("should handle dots in Claude version numbers", () => {
        // given a Claude model ID with dot format
        const variant = getHighVariant("claude-opus-4.6")

        // then should return high variant with hyphen format
        expect(variant).toBe("claude-opus-4-6-high")
      })

      it("should handle hyphens in Claude version numbers", () => {
        // given a Claude model ID with hyphen format
        const variant = getHighVariant("claude-opus-4-6")

        // then should return high variant
        expect(variant).toBe("claude-opus-4-6-high")
      })

      it("should handle claude-opus-4-6 high variant", () => {
        // given a Claude Opus 4.6 model ID
        const variant = getHighVariant("claude-opus-4-6")

        // then should return high variant
        expect(variant).toBe("claude-opus-4-6-high")
      })

      it("should handle dots in GPT version numbers", () => {
        // given a GPT model ID with dot format (gpt-5.4)
        const variant = getHighVariant("gpt-5.4")

        // then should return high variant
        expect(variant).toBe("gpt-5-4-high")
      })

      it("should handle dots in GPT-5.1 codex variants", () => {
        // given a GPT-5.1-codex model ID
        const variant = getHighVariant("gpt-5.1-codex")

        // then should return high variant
        expect(variant).toBe("gpt-5-1-codex-high")
      })

      it("should handle Gemini preview variants", () => {
        // given Gemini preview model IDs
        expect(getHighVariant("gemini-3.1-pro")).toBe(
          "gemini-3-1-pro-high"
        )
        expect(getHighVariant("gemini-3-flash")).toBe(
          "gemini-3-flash-high"
        )
      })

      it("should return null for already-high variants", () => {
        // given model IDs that are already high variants
        expect(getHighVariant("claude-opus-4-6-high")).toBeNull()
        expect(getHighVariant("gpt-5-4-high")).toBeNull()
        expect(getHighVariant("gemini-3-1-pro-high")).toBeNull()
      })

      it("should return null for unknown models", () => {
        // given unknown model IDs
        expect(getHighVariant("llama-3-70b")).toBeNull()
        expect(getHighVariant("mistral-large")).toBeNull()
      })
    })
  })

  describe("isAlreadyHighVariant", () => {
    it("should detect -high suffix", () => {
      // given model IDs with -high suffix
      expect(isAlreadyHighVariant("claude-opus-4-6-high")).toBe(true)
      expect(isAlreadyHighVariant("gpt-5-4-high")).toBe(true)
      expect(isAlreadyHighVariant("gemini-3.1-pro-high")).toBe(true)
    })

    it("should detect -high suffix after normalization", () => {
      // given model IDs with dots that end in -high
      expect(isAlreadyHighVariant("gpt-5.4-high")).toBe(true)
    })

    it("should return false for base models", () => {
      // given base model IDs without -high suffix
      expect(isAlreadyHighVariant("claude-opus-4-6")).toBe(false)
      expect(isAlreadyHighVariant("claude-opus-4.6")).toBe(false)
      expect(isAlreadyHighVariant("gpt-5.4")).toBe(false)
      expect(isAlreadyHighVariant("gemini-3.1-pro")).toBe(false)
    })

    it("should return false for models with 'high' in name but not suffix", () => {
      // given model IDs that contain 'high' but not as suffix
      expect(isAlreadyHighVariant("high-performance-model")).toBe(false)
    })
  })

  describe("Custom provider prefixes support", () => {
    describe("getHighVariant with prefixes", () => {
      it("should preserve vertex_ai/ prefix when getting high variant", () => {
        // given a model ID with vertex_ai/ prefix
        const variant = getHighVariant("vertex_ai/claude-sonnet-4-6")

        // then should return high variant with prefix preserved
        expect(variant).toBe("vertex_ai/claude-sonnet-4-6-high")
      })

      it("should preserve openai/ prefix when getting high variant", () => {
        // given a model ID with openai/ prefix
        const variant = getHighVariant("openai/gpt-5-4")

        // then should return high variant with prefix preserved
        expect(variant).toBe("openai/gpt-5-4-high")
      })

      it("should handle prefixes with dots in version numbers", () => {
        // given a model ID with prefix and dots
        const variant = getHighVariant("vertex_ai/claude-opus-4.6")

        // then should normalize dots and preserve prefix
        expect(variant).toBe("vertex_ai/claude-opus-4-6-high")
      })

      it("should handle multiple different prefixes", () => {
        // given various custom prefixes
        expect(getHighVariant("azure/gpt-5")).toBe("azure/gpt-5-high")
        expect(getHighVariant("bedrock/claude-sonnet-4-6")).toBe("bedrock/claude-sonnet-4-6-high")
        expect(getHighVariant("custom-llm/gemini-3.1-pro")).toBe("custom-llm/gemini-3-1-pro-high")
      })

      it("should handle multi-slash model IDs (#2852)", () => {
        // given model IDs with multiple slashes (e.g. aws/anthropic/claude-sonnet-4)
        const variant = getHighVariant("aws/anthropic/claude-sonnet-4-6")

        // then should split at last slash, preserving full provider prefix
        expect(variant).toBe("aws/anthropic/claude-sonnet-4-6-high")
      })

      it("should return null for multi-slash unknown models", () => {
        // given multi-slash model ID without high variant mapping
        expect(getHighVariant("aws/anthropic/unknown-model")).toBeNull()
      })

      it("should return null for prefixed models without high variant mapping", () => {
        // given prefixed model IDs without high variant mapping
        expect(getHighVariant("vertex_ai/unknown-model")).toBeNull()
        expect(getHighVariant("custom/llama-3-70b")).toBeNull()
      })

      it("should return null for already-high prefixed models", () => {
        // given prefixed model IDs that are already high
        expect(getHighVariant("vertex_ai/claude-opus-4-6-high")).toBeNull()
        expect(getHighVariant("openai/gpt-5-4-high")).toBeNull()
      })
    })

    describe("isAlreadyHighVariant with prefixes", () => {
      it("should detect -high suffix in prefixed models", () => {
        // given prefixed model IDs with -high suffix
        expect(isAlreadyHighVariant("vertex_ai/claude-opus-4-6-high")).toBe(true)
        expect(isAlreadyHighVariant("openai/gpt-5-4-high")).toBe(true)
        expect(isAlreadyHighVariant("custom/gemini-3.1-pro-high")).toBe(true)
      })

      it("should return false for prefixed base models", () => {
        // given prefixed base model IDs without -high suffix
        expect(isAlreadyHighVariant("vertex_ai/claude-opus-4-6")).toBe(false)
        expect(isAlreadyHighVariant("openai/gpt-5-4")).toBe(false)
      })

      it("should handle prefixed models with dots", () => {
        // given prefixed model IDs with dots
        expect(isAlreadyHighVariant("vertex_ai/gpt-5.4")).toBe(false)
        expect(isAlreadyHighVariant("vertex_ai/gpt-5.4-high")).toBe(true)
      })
    })
})
})

import { describe, test, expect, mock } from "bun:test"
import {
  parseModelString,
  modelSpecToString,
  buildModelChain,
  isModelError,
  withModelFallback,
  formatRetryErrors,
  type ModelSpec,
  type RetryResult,
} from "./index"

describe("model-fallback", () => {
  describe("parseModelString", () => {
    test("parses valid provider/model string", () => {
      // #given
      const modelString = "anthropic/claude-opus-4-5"

      // #when
      const result = parseModelString(modelString)

      // #then
      expect(result).toBeDefined()
      expect(result?.providerID).toBe("anthropic")
      expect(result?.modelID).toBe("claude-opus-4-5")
    })

    test("parses model string with nested path", () => {
      // #given
      const modelString = "a-llm-nextologies/anthropic/claude-opus-4-5"

      // #when
      const result = parseModelString(modelString)

      // #then
      expect(result).toBeDefined()
      expect(result?.providerID).toBe("a-llm-nextologies")
      expect(result?.modelID).toBe("anthropic/claude-opus-4-5")
    })

    test("returns undefined for single segment string", () => {
      // #given
      const modelString = "claude-opus"

      // #when
      const result = parseModelString(modelString)

      // #then
      expect(result).toBeUndefined()
    })

    test("returns undefined for empty string", () => {
      // #given
      const modelString = ""

      // #when
      const result = parseModelString(modelString)

      // #then
      expect(result).toBeUndefined()
    })
  })

  describe("modelSpecToString", () => {
    test("converts ModelSpec to string", () => {
      // #given
      const spec: ModelSpec = {
        providerID: "anthropic",
        modelID: "claude-opus-4-5",
      }

      // #when
      const result = modelSpecToString(spec)

      // #then
      expect(result).toBe("anthropic/claude-opus-4-5")
    })

    test("handles nested modelID", () => {
      // #given
      const spec: ModelSpec = {
        providerID: "a-llm-nextologies",
        modelID: "anthropic/claude-opus-4-5",
      }

      // #when
      const result = modelSpecToString(spec)

      // #then
      expect(result).toBe("a-llm-nextologies/anthropic/claude-opus-4-5")
    })
  })

  describe("buildModelChain", () => {
    test("builds chain with primary model only", () => {
      // #given
      const primary = "anthropic/claude-opus-4-5"

      // #when
      const chain = buildModelChain(primary)

      // #then
      expect(chain).toHaveLength(1)
      expect(chain[0].providerID).toBe("anthropic")
      expect(chain[0].modelID).toBe("claude-opus-4-5")
    })

    test("builds chain with primary and fallback models", () => {
      // #given
      const primary = "anthropic/claude-opus-4-5"
      const fallback = ["anthropic/claude-sonnet-4-5", "openai/gpt-5.2"]

      // #when
      const chain = buildModelChain(primary, fallback)

      // #then
      expect(chain).toHaveLength(3)
      expect(chain[0].providerID).toBe("anthropic")
      expect(chain[0].modelID).toBe("claude-opus-4-5")
      expect(chain[1].providerID).toBe("anthropic")
      expect(chain[1].modelID).toBe("claude-sonnet-4-5")
      expect(chain[2].providerID).toBe("openai")
      expect(chain[2].modelID).toBe("gpt-5.2")
    })

    test("skips invalid model strings in fallback", () => {
      // #given
      const primary = "anthropic/claude-opus-4-5"
      const fallback = ["invalid-model", "openai/gpt-5.2"]

      // #when
      const chain = buildModelChain(primary, fallback)

      // #then
      expect(chain).toHaveLength(2)
      expect(chain[0].modelID).toBe("claude-opus-4-5")
      expect(chain[1].modelID).toBe("gpt-5.2")
    })

    test("returns empty chain for invalid primary", () => {
      // #given
      const primary = "invalid"

      // #when
      const chain = buildModelChain(primary)

      // #then
      expect(chain).toHaveLength(0)
    })

    test("handles empty fallback array", () => {
      // #given
      const primary = "anthropic/claude-opus-4-5"
      const fallback: string[] = []

      // #when
      const chain = buildModelChain(primary, fallback)

      // #then
      expect(chain).toHaveLength(1)
    })

    test("handles undefined fallback", () => {
      // #given
      const primary = "anthropic/claude-opus-4-5"

      // #when
      const chain = buildModelChain(primary, undefined)

      // #then
      expect(chain).toHaveLength(1)
    })
  })

  describe("isModelError", () => {
    test("returns true for rate limit error", () => {
      // #given
      const error = new Error("Rate limit exceeded")

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(true)
    })

    test("returns true for 429 error", () => {
      // #given
      const error = new Error("Request failed with status 429")

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(true)
    })

    test("returns true for 503 error", () => {
      // #given
      const error = new Error("Service unavailable: 503")

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(true)
    })

    test("returns true for 502 error", () => {
      // #given
      const error = new Error("Bad gateway: 502")

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(true)
    })

    test("returns true for timeout error", () => {
      // #given
      const error = new Error("Request timeout")

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(true)
    })

    test("returns true for unavailable error", () => {
      // #given
      const error = new Error("Model is unavailable")

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(true)
    })

    test("returns true for overloaded error", () => {
      // #given
      const error = new Error("Server is overloaded")

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(true)
    })

    test("returns true for capacity error", () => {
      // #given
      const error = new Error("No capacity available")

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(true)
    })

    test("returns true for ECONNREFUSED error", () => {
      // #given
      const error = new Error("connect ECONNREFUSED")

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(true)
    })

    test("returns true for ENOTFOUND error", () => {
      // #given
      const error = new Error("getaddrinfo ENOTFOUND")

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(true)
    })

    test("returns false for non-model errors", () => {
      // #given
      const error = new Error("Invalid input parameter")

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(false)
    })

    test("returns false for non-Error objects", () => {
      // #given
      const error = "string error"

      // #when
      const result = isModelError(error)

      // #then
      expect(result).toBe(false)
    })

    test("returns false for null", () => {
      // #given / #when
      const result = isModelError(null)

      // #then
      expect(result).toBe(false)
    })
  })

  describe("withModelFallback", () => {
    test("succeeds on first model", async () => {
      // #given
      const chain = buildModelChain("anthropic/claude-opus-4-5", ["openai/gpt-5.2"])
      const operation = mock(async (model: ModelSpec) => `success:${model.modelID}`)

      // #when
      const result = await withModelFallback(chain, operation)

      // #then
      expect(result.success).toBe(true)
      expect(result.result).toBe("success:claude-opus-4-5")
      expect(result.attempts).toBe(1)
      expect(result.errors).toHaveLength(0)
      expect(operation).toHaveBeenCalledTimes(1)
    })

    test("falls back on model error", async () => {
      // #given
      const chain = buildModelChain("anthropic/claude-opus-4-5", ["openai/gpt-5.2"])
      let callCount = 0
      const operation = mock(async (model: ModelSpec) => {
        callCount++
        if (callCount === 1) {
          throw new Error("Rate limit exceeded")
        }
        return `success:${model.modelID}`
      })

      // #when
      const result = await withModelFallback(chain, operation, { retryConfig: { delayMs: 10 } })

      // #then
      expect(result.success).toBe(true)
      expect(result.result).toBe("success:gpt-5.2")
      expect(result.attempts).toBe(2)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].error).toContain("Rate limit")
    })

    test("does not retry on non-model errors", async () => {
      // #given
      const chain = buildModelChain("anthropic/claude-opus-4-5", ["openai/gpt-5.2"])
      const operation = mock(async (_model: ModelSpec) => {
        throw new Error("Invalid prompt format")
      })

      // #when
      const result = await withModelFallback(chain, operation)

      // #then
      expect(result.success).toBe(false)
      expect(result.attempts).toBe(1)
      expect(result.errors).toHaveLength(1)
      expect(operation).toHaveBeenCalledTimes(1)
    })

    test("exhausts all models on persistent failures", async () => {
      // #given
      const chain = buildModelChain("anthropic/claude-opus-4-5", [
        "openai/gpt-5.2",
        "google/gemini-3-flash",
      ])
      const operation = mock(async (_model: ModelSpec) => {
        throw new Error("Service unavailable")
      })

      // #when
      const result = await withModelFallback(chain, operation, { retryConfig: { delayMs: 10 } })

      // #then
      expect(result.success).toBe(false)
      expect(result.attempts).toBe(3)
      expect(result.errors).toHaveLength(3)
      expect(operation).toHaveBeenCalledTimes(3)
    })

    test("respects maxAttempts config", async () => {
      // #given
      const chain = buildModelChain("anthropic/claude-opus-4-5", [
        "openai/gpt-5.2",
        "google/gemini-3-flash",
      ])
      const operation = mock(async (_model: ModelSpec) => {
        throw new Error("Rate limit exceeded")
      })

      // #when
      const result = await withModelFallback(chain, operation, {
        retryConfig: { maxAttempts: 2, delayMs: 10 },
      })

      // #then
      expect(result.success).toBe(false)
      expect(result.attempts).toBe(2)
      expect(operation).toHaveBeenCalledTimes(2)
    })

    test("handles NaN maxAttempts by falling back to chain length", async () => {
      // #given - chain with 3 models, all fail with retryable error
      const chain = buildModelChain("anthropic/claude-opus-4-5", [
        "openai/gpt-5.2",
        "google/gemini-3-flash",
      ])
      const operation = mock(async (_model: ModelSpec) => {
        throw new Error("Rate limit exceeded")
      })

      // #when - NaN maxAttempts should fall back to chain.length (3)
      const result = await withModelFallback(chain, operation, {
        retryConfig: { maxAttempts: NaN, delayMs: 10 },
      })

      // #then - all 3 models should be tried (proves maxAttempts=3, not 1)
      expect(result.success).toBe(false)
      expect(result.attempts).toBe(3)
      expect(Number.isNaN(result.attempts)).toBe(false)
      expect(operation).toHaveBeenCalledTimes(3)
      expect(result.errors).toHaveLength(3)
    })

    test("returns error for empty model chain", async () => {
      // #given
      const chain: ModelSpec[] = []
      const operation = mock(async (_model: ModelSpec) => "success")

      // #when
      const result = await withModelFallback(chain, operation)

      // #then
      expect(result.success).toBe(false)
      expect(result.attempts).toBe(0)
      expect(result.errors).toHaveLength(1)
      expect(result.errors[0].error).toContain("No models configured")
      expect(operation).not.toHaveBeenCalled()
    })

    test("records usedModel on success", async () => {
      // #given
      const chain = buildModelChain("anthropic/claude-opus-4-5")
      const operation = mock(async (_model: ModelSpec) => "result")

      // #when
      const result = await withModelFallback(chain, operation)

      // #then
      expect(result.usedModel).toBeDefined()
      expect(result.usedModel?.modelID).toBe("claude-opus-4-5")
    })

    test("records usedModel on failure", async () => {
      // #given
      const chain = buildModelChain("anthropic/claude-opus-4-5")
      const operation = mock(async (_model: ModelSpec) => {
        throw new Error("Some error")
      })

      // #when
      const result = await withModelFallback(chain, operation)

      // #then
      expect(result.usedModel).toBeDefined()
      expect(result.usedModel?.modelID).toBe("claude-opus-4-5")
    })
  })

  describe("formatRetryErrors", () => {
    test("returns 'No errors' for empty array", () => {
      // #given
      const errors: Array<{ model: string; error: string }> = []

      // #when
      const result = formatRetryErrors(errors)

      // #then
      expect(result).toBe("No errors")
    })

    test("formats single error inline", () => {
      // #given
      const errors = [{ model: "anthropic/claude-opus-4-5", error: "Rate limit exceeded" }]

      // #when
      const result = formatRetryErrors(errors)

      // #then
      expect(result).toBe("anthropic/claude-opus-4-5: Rate limit exceeded")
    })

    test("formats multiple errors as numbered list", () => {
      // #given
      const errors = [
        { model: "anthropic/claude-opus-4-5", error: "Rate limit exceeded" },
        { model: "openai/gpt-5.2", error: "Service unavailable" },
      ]

      // #when
      const result = formatRetryErrors(errors)

      // #then
      expect(result).toContain("1. anthropic/claude-opus-4-5: Rate limit exceeded")
      expect(result).toContain("2. openai/gpt-5.2: Service unavailable")
    })
  })
})

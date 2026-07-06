import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test"

import { _setModelResolutionLogImplementationForTesting } from "./model-resolution-pipeline"
import { resolveModelWithFallback, type ExtendedModelResolutionInput, type ModelResolutionResult } from "./model-resolver"

const logMock = mock(() => {})

function expectResolved(result: ModelResolutionResult | undefined): ModelResolutionResult {
  if (result === undefined) {
    throw new Error("expected model resolution result")
  }
  return result
}

describe("resolveModelWithFallback provider scoping", () => {
  beforeEach(() => {
    logMock.mockClear()
    _setModelResolutionLogImplementationForTesting(logMock)
  })

  afterEach(() => {
    _setModelResolutionLogImplementationForTesting(undefined)
  })

  test("skips same-name models from other providers when preferred provider unavailable", () => {
    // given
    const input: ExtendedModelResolutionInput = {
      fallbackChain: [
        { providers: ["zai-coding-plan"], model: "glm-5" },
        { providers: ["anthropic"], model: "claude-sonnet-4-6" },
      ],
      availableModels: new Set(["opencode/glm-5", "anthropic/claude-sonnet-4-6"]),
      systemDefaultModel: "google/gemini-3.1-pro",
    }

    // when
    const result = resolveModelWithFallback(input)
    const resolved = expectResolved(result)

    // then
    expect(resolved.model).toBe("anthropic/claude-sonnet-4-6")
    expect(resolved.source).toBe("provider-fallback")
    expect(logMock).not.toHaveBeenCalledWith("Model resolved via fallback chain (cross-provider fuzzy match)", expect.anything())
  })

  test("prefers specified provider over same-name model from another provider", () => {
    // given
    const input: ExtendedModelResolutionInput = {
      fallbackChain: [
        { providers: ["zai-coding-plan"], model: "glm-5" },
      ],
      availableModels: new Set(["zai-coding-plan/glm-5", "opencode/glm-5"]),
      systemDefaultModel: "google/gemini-3.1-pro",
    }

    // when
    const result = resolveModelWithFallback(input)
    const resolved = expectResolved(result)

    // then
    expect(resolved.model).toBe("zai-coding-plan/glm-5")
    expect(resolved.source).toBe("provider-fallback")
  })

  test("does not preserve variant from an unmatched provider-scoped entry", () => {
    // given
    const input: ExtendedModelResolutionInput = {
      fallbackChain: [
        { providers: ["zai-coding-plan"], model: "glm-5", variant: "high" },
      ],
      availableModels: new Set(["opencode/glm-5"]),
      systemDefaultModel: "google/gemini-3.1-pro",
    }

    // when
    const result = resolveModelWithFallback(input)
    const resolved = expectResolved(result)

    // then
    expect(resolved.model).toBe("google/gemini-3.1-pro")
    expect(resolved.source).toBe("system-default")
    expect(resolved.variant).toBeUndefined()
  })
})

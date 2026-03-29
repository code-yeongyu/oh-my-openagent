import { afterEach, describe, expect, mock, spyOn, test } from "bun:test"
import { resolveModelPipeline } from "./model-resolution-pipeline"
import * as connectedProvidersCache from "./connected-providers-cache"

// Force test-runner isolation: files that import mock.module are auto-detected
// by run-ci-tests.ts and executed in their own bun process so they cannot be
// contaminated by (or contaminate) mock.module calls in other test files.
mock.module("./logger", () => ({
  log: () => {},
}))

describe("resolveModelPipeline", () => {
  afterEach(() => {
    mock.restore()
  })

  test("does not return unused explicit user config metadata in override result", () => {
    // given
    const result = resolveModelPipeline({
      intent: {
        userModel: "openai/gpt-5.3-codex",
      },
      constraints: {
        availableModels: new Set<string>(),
      },
    })

    // when
    const hasExplicitUserConfigField = result
      ? Object.prototype.hasOwnProperty.call(result, "explicitUserConfig")
      : false

    // then
    expect(result).toEqual({ model: "openai/gpt-5.3-codex", provenance: "override" })
    expect(hasExplicitUserConfigField).toBe(false)
  })

  test("keeps explicit fallback_models stable against available concrete versions", () => {
    // given
    const result = resolveModelPipeline({
      intent: {
        userFallbackModels: ["openai/gpt-5"],
      },
      constraints: {
        availableModels: new Set(["openai/gpt-5.4"]),
      },
    })

    // then
    expect(result).toEqual({
      model: "openai/gpt-5",
      provenance: "provider-fallback",
      attempted: ["openai/gpt-5"],
    })
  })

  test("keeps explicit fallback_models stable on cold cache with connected providers", () => {
    // given
    const readConnectedProvidersSpy = spyOn(
      connectedProvidersCache,
      "readConnectedProvidersCache",
    ).mockReturnValue(["openai"])

    const result = resolveModelPipeline({
      intent: {
        userFallbackModels: ["openai/gpt-5"],
      },
      constraints: {
        availableModels: new Set<string>(),
      },
    })

    readConnectedProvidersSpy.mockRestore()

    // then
    expect(result).toEqual({
      model: "openai/gpt-5",
      provenance: "provider-fallback",
      attempted: ["openai/gpt-5"],
    })
  })

  test("fuzzy-resolves object fallback_models entries to available concrete models", () => {
    // given
    const result = resolveModelPipeline({
      intent: {
        userFallbackModels: [
          { model: "openai/gpt-5.4", variant: "high", reasoningEffort: "high" },
        ],
      },
      constraints: {
        availableModels: new Set(["openai/gpt-5.4-preview"]),
      },
    })

    // then
    expect(result).toEqual({
      model: "openai/gpt-5.4-preview",
      provenance: "provider-fallback",
      variant: "high",
      attempted: ["openai/gpt-5.4"],
    })
  })

  test("uses object fallback_models entries on cold cache when their provider is connected", () => {
    // given
    const readConnectedProvidersSpy = spyOn(
      connectedProvidersCache,
      "readConnectedProvidersCache",
    ).mockReturnValue(["openai"])

    const result = resolveModelPipeline({
      intent: {
        userFallbackModels: [
          { model: "openai/gpt-5.4", variant: "high", reasoningEffort: "high" },
        ],
      },
      constraints: {
        availableModels: new Set<string>(),
      },
    })

    readConnectedProvidersSpy.mockRestore()

    // then
    expect(result).toEqual({
      model: "openai/gpt-5.4",
      provenance: "provider-fallback",
      variant: "high",
      attempted: ["openai/gpt-5.4"],
    })
  })
})

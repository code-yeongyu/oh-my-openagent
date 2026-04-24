import { describe, expect, mock, test } from "bun:test"
import { resolveModelPipeline } from "./model-resolution-pipeline"

// Force test-runner isolation: files that import mock.module are auto-detected
// by run-ci-tests.ts and executed in their own bun process so they cannot be
// contaminated by (or contaminate) mock.module calls in other test files.
mock.module("./logger", () => ({
  log: () => {},
}))

describe("resolveModelPipeline", () => {
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

  test("normalizes legacy gateway aliases in category defaults before connected-provider resolution", () => {
    // given
    const result = resolveModelPipeline({
      intent: {
        categoryDefaultModel: "gateway/gpt-5.4",
      },
      constraints: {
        availableModels: new Set<string>(),
        connectedProviders: ["vercel"],
      },
    })

    // then
    expect(result).toEqual({
      model: "vercel/openai/gpt-5.4",
      provenance: "category-default",
      attempted: ["vercel/openai/gpt-5.4"],
    })
  })

  test("normalizes legacy gateway aliases in user fallback models before provider fallback resolution", () => {
    // given
    const result = resolveModelPipeline({
      intent: {
        userFallbackModels: ["gateway/gpt-5.4"],
      },
      constraints: {
        availableModels: new Set<string>(),
        connectedProviders: ["vercel"],
      },
    })

    // then
    expect(result).toEqual({
      model: "vercel/openai/gpt-5.4",
      provenance: "provider-fallback",
      attempted: ["vercel/openai/gpt-5.4"],
    })
  })
})
